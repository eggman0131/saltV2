import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonItem } from '@salt/domain';

// ─── Trace propagation into the canon write-back (issue #362, Phase 2) ────────
//
// The canonicalise batch runs inside the browser-rooted trace the field-preferred
// callable entrypoint installed (Phase 1). This test asserts the batch reads that
// ACTIVE traceparent via activeTraceparent() and threads it through
// buildMatchOrCreatePorts → createFirestoreCanonStore, which stamps it as
// `traceContext` on every NEW canon doc — so onCanonItemWritten continues the SAME
// import trace (the per-ingredient icon/embedding work nests under the recipe
// import instead of N separate root traces). And that, when activeTraceparent()
// returns undefined (no active context — local emulators / no inbound trace), the
// written docs are BYTE-IDENTICAL (no traceContext field): the degrade contract.
//
// The flow + the real domain matchOrCreateBatch + the real createFirestoreCanonStore
// run against an in-memory Firestore (mirrors matchOrCreateCanon.test.ts). Only the
// observability barrel is mocked: this drives activeTraceparent()'s return value
// (the serialization itself is unit-tested in the observability package, where the
// real OTel propagator round-trip lives) and keeps the un-importable transitive
// @opentelemetry/api off the cloud-functions test path, exactly as
// onCanonItemWritten.trace.test.ts does.

// ─── In-memory Firestore mock (mirrors matchOrCreateCanon.test.ts) ────────────

const collections = new Map<string, Map<string, Record<string, unknown>>>();

function getCollection(name: string) {
  let c = collections.get(name);
  if (!c) {
    c = new Map();
    collections.set(name, c);
  }
  return c;
}

function resetFirestore() {
  collections.clear();
}

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name: string) => {
      const store = getCollection(name);
      return {
        doc: (id: string) => ({
          async set(data: Record<string, unknown>) {
            store.set(id, data);
          },
          async get() {
            return { exists: store.has(id), data: () => store.get(id) };
          },
          async delete() {
            store.delete(id);
          },
        }),
        async get() {
          return { docs: [...store.values()].map((data) => ({ data: () => data })) };
        },
      };
    },
  }),
}));

// Genkit: defineFlow returns the handler directly.
vi.mock('../../src/genkit.js', () => ({
  ai: { defineFlow: (_cfg: unknown, handler: unknown) => handler },
}));

// AI flows stubbed — only the trace stamping matters here.
const mockEmbed = vi.fn(async (_input: { text: string }) => ({ values: [0, 0, 0] }));
const mockArbitrate = vi.fn();
vi.mock('../../src/flows/embedText.js', () => ({
  embedTextFlow: (input: { text: string }) => mockEmbed(input),
}));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({
  arbitrateCanonFlow: (input: unknown) => mockArbitrate(input),
}));

// Observability barrel: keep every REAL export (the transitive graph —
// matchOrCreateCanon, firestoreCanonStore, the match-log/embedding/arbitration
// adapters — binds many of them at load), and override only activeTraceparent() so
// the test can drive its return. startSpan is left real (returns an inert no-op
// span when uninitialised — no POSTHOG_API_KEY in tests). The serialization itself
// is unit-tested in packages/adapters/observability/tests/activeTraceparent.test.ts;
// here we assert the flow→store WIRING stamps whatever activeTraceparent() yields.
let activeTp: string | undefined;
vi.mock('@salt/observability/server', async (importActual) => {
  const actual = await importActual<typeof import('@salt/observability/server')>();
  return { ...actual, activeTraceparent: () => activeTp };
});

const { canonicaliseRecipeIngredientsFlow } =
  await import('../../src/flows/canonicaliseRecipeIngredients.js');

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

function readCanonStorage(): Record<string, unknown>[] {
  return [...getCollection('canonItems').values()];
}

beforeEach(() => {
  resetFirestore();
  mockEmbed.mockClear();
  mockArbitrate.mockReset();
  activeTp = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canonicaliseRecipeIngredients — traceContext stamping (Phase 2)', () => {
  it('stamps the ACTIVE browser traceparent onto every new canon doc', async () => {
    // Simulate the batch running inside the installed browser trace.
    activeTp = TRACEPARENT;

    const result = await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'Tinned Tomatoes' }, { rawName: 'Chickpeas' }],
    });

    // Both ingredients are brand new → created → persisted.
    expect(result).toHaveLength(2);
    for (const r of result) expect(r.kind).toBe('ok');

    const stored = readCanonStorage();
    expect(stored).toHaveLength(2);
    // Every new canon doc carries the EXACT browser traceparent — this is the
    // field onCanonItemWritten reads to nest its icon/embedding work in the same
    // import trace (the user-testable outcome).
    for (const doc of stored) {
      expect(doc.traceContext).toBe(TRACEPARENT);
    }
  });

  it('writes BYTE-IDENTICAL docs (no traceContext field) when no context is active', async () => {
    // activeTraceparent() returns undefined → buildMatchOrCreatePorts(batchSpan,
    // undefined) → the canon store omits the field entirely (not
    // traceContext: undefined). Same path as local emulators / no inbound trace.
    activeTp = undefined;

    const result = await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'Olive Oil' }],
    });

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('ok');

    const stored = readCanonStorage();
    expect(stored).toHaveLength(1);
    // The KEY must be ABSENT, not present-and-undefined — byte-identical to the
    // pre-Phase-2 / non-traced doc, so old back-compat reads are unchanged.
    expect(Object.prototype.hasOwnProperty.call(stored[0]!, 'traceContext')).toBe(false);
  });

  it('completes the batch and writes docs even if activeTraceparent yields undefined (degrade, Rule 10)', async () => {
    // activeTraceparent() degrades to undefined on any serialization failure; the
    // batch must still complete and persist its docs (best-effort tracing only).
    activeTp = undefined;

    let result: Array<{ kind: string }> | undefined;
    await expect(
      (async () => {
        result = await (canonicaliseRecipeIngredientsFlow as Function)({
          items: [{ rawName: 'Basil' }],
        });
      })(),
    ).resolves.toBeUndefined();

    expect(result).toHaveLength(1);
    expect(result![0]!.kind).toBe('ok');
    const stored = readCanonStorage();
    expect(stored).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(stored[0]!, 'traceContext')).toBe(false);
  });

  it('the stamped doc is exactly the value onCanonItemWritten would run within', async () => {
    // Tie-in to the downstream trigger: the value stamped here is precisely what
    // onCanonItemWritten reads off the doc and passes to runWithSuppliedTraceContext,
    // so the icon/embedding work nests under this import trace.
    activeTp = TRACEPARENT;
    await (canonicaliseRecipeIngredientsFlow as Function)({ items: [{ rawName: 'Cumin' }] });
    const [doc] = readCanonStorage() as unknown as CanonItem[];
    expect((doc as unknown as { traceContext?: string }).traceContext).toBe(TRACEPARENT);
  });
});
