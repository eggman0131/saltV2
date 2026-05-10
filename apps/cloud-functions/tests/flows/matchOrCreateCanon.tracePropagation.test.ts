import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonItem } from '@salt/domain';

// ─── In-memory Firestore mock ─────────────────────────────────────────────────

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

vi.mock('../../src/genkit.js', () => ({
  ai: { defineFlow: (_cfg: unknown, handler: unknown) => handler },
}));

const mockEmbed = vi.fn(async () => ({ values: [0, 0, 0] }));
const mockArbitrate = vi.fn();
vi.mock('../../src/flows/embedText.js', () => ({
  embedTextFlow: (input: { text: string }) => mockEmbed(input),
}));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({
  arbitrateCanonFlow: (input: unknown) => mockArbitrate(input),
}));

// ─── Spy on the server LD observability surface ───────────────────────────────

const startSpanCalls: Array<{
  name: string;
  opts?: { headers?: Record<string, string>; parent?: unknown };
}> = [];

const fakeSpan = {
  setAttribute: vi.fn(),
  end: vi.fn(),
};

vi.mock('@salt/ld-observability/server', () => ({
  initServerObservability: vi.fn(),
  isServerObservabilityInitialised: () => true,
  whenServerObservabilityReady: vi.fn(async () => {}),
  flushServerObservability: vi.fn(async () => {}),
  startSpan: vi.fn((name: string, opts?: unknown) => {
    startSpanCalls.push({ name, opts: opts as { headers?: Record<string, string> } });
    return fakeSpan;
  }),
  createServerLDMatchLoggingAdapter: () => ({
    write: vi.fn(async () => {}),
  }),
}));

const { matchOrCreateCanonFlow } = await import('../../src/flows/matchOrCreateCanon.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 4,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetFirestore();
  startSpanCalls.length = 0;
  fakeSpan.setAttribute.mockClear();
  fakeSpan.end.mockClear();
  mockEmbed.mockClear();
  mockArbitrate.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('matchOrCreateCanon — trace propagation + _trace stripping', () => {
  const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

  // Trace context propagation is now handled at the callable entrypoint
  // (apps/cloud-functions/src/index.ts) via runWithExtractedTraceContext,
  // which installs the browser's trace as the active OTel context BEFORE
  // the flow opens any span. The flow itself opens spans with no headers
  // option — they inherit from context.active() automatically.
  it('opens the parent span without forwarding _trace (entrypoint sets active context)', async () => {
    getCollection('canonItems').set(
      'tomato-1',
      makeItem({ id: 'tomato-1', name: 'Tomato' }) as unknown as Record<string, unknown>,
    );

    const result = await (matchOrCreateCanonFlow as Function)({
      rawName: 'tomato',
      _trace: { traceparent },
    });

    expect(result.kind).toBe('ok');
    expect(startSpanCalls).toHaveLength(1);
    expect(startSpanCalls[0]!.name).toBe('canon.matchOrCreateCanon: tomato');
    expect(startSpanCalls[0]!.opts).toBeUndefined();
  });

  it('opens the parent span without headers when _trace is absent', async () => {
    getCollection('canonItems').set(
      'tomato-1',
      makeItem({ id: 'tomato-1', name: 'Tomato' }) as unknown as Record<string, unknown>,
    );

    await (matchOrCreateCanonFlow as Function)({ rawName: 'tomato' });

    expect(startSpanCalls).toHaveLength(1);
    expect(startSpanCalls[0]!.opts).toBeUndefined();
  });

  it('does not leak _trace into the persisted CanonItem', async () => {
    const result = await (matchOrCreateCanonFlow as Function)({
      rawName: 'Cucumber',
      forceCreate: true,
      _trace: { traceparent, tracestate: 'rojo=00f067aa0ba902b7' },
    });

    expect(result.kind).toBe('ok');
    expect(result.value.decision).toBe('created');
    expect(result.value.item).not.toHaveProperty('_trace');
    expect(result.value.item).not.toHaveProperty('traceparent');

    const stored = [...getCollection('canonItems').values()][0]!;
    expect(stored).not.toHaveProperty('_trace');
    expect(stored).not.toHaveProperty('traceparent');
  });

  it('flushes telemetry and ends the parent span even when matchOrCreate errors', async () => {
    // Empty rawName triggers ValidationError before any matching work.
    const result = await (matchOrCreateCanonFlow as Function)({
      rawName: '   ',
      _trace: { traceparent },
    });

    expect(result.kind).toBe('err');
    // Span was opened with the trace context, then closed.
    expect(startSpanCalls).toHaveLength(1);
    expect(fakeSpan.end).toHaveBeenCalledOnce();
  });
});
