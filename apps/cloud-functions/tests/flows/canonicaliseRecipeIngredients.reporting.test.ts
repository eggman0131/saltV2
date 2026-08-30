import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── The recipe batch announces its failed productForms read (issue #1117) ────
//
// The batch reads `productForms` once up front and degrades to `forms = []` when
// that read fails (Rule 10, unchanged). Downstream, that empty array is
// indistinguishable from a legitimately empty table — but only one of the two is
// a fault, and the batch loses more to it than the callable does: form binding is
// off for every ingredient AND the `isDerivedName` guard it hands the matcher
// answers `false` to everything, so a derivation can be recorded as a synonym of
// its own parent for the whole recipe.
//
// These tests pin the signal on the failure and the silence on the empty table.
// The `reporting.test.ts` suffix follows extractRecipeFromUrl / generateChatTitle.

const collections = new Map<string, Map<string, Record<string, unknown>>>();
// Collections whose `.get()` rejects, so a test can drive the read-failure branch
// rather than merely an absent collection.
const failingReads = new Set<string>();

function getCollection(name: string) {
  let c = collections.get(name);
  if (!c) {
    c = new Map();
    collections.set(name, c);
  }
  return c;
}

function docsOf(name: string) {
  return [...getCollection(name).entries()].map(([id, data]) => ({
    id,
    data: () => data,
    get: (field: string) => data[field],
  }));
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
        // The produced-canon read is a field PROJECTION, so the mock has to offer
        // `select()` as well as a bare `get()`.
        select: () => ({
          async get() {
            if (failingReads.has(name)) throw new Error(`simulated ${name} read failure`);
            return { docs: docsOf(name) };
          },
        }),
        async get() {
          if (failingReads.has(name)) throw new Error(`simulated ${name} read failure`);
          return { docs: docsOf(name) };
        },
      };
    },
  }),
}));

// Genkit: defineFlow returns the handler directly.
vi.mock('../../src/genkit.js', () => ({
  ai: { defineFlow: (_cfg: unknown, handler: unknown) => handler },
}));

// The AI flows are never reached with an empty item list, but stubbing them keeps
// module load inert and free of API-key expectations.
vi.mock('../../src/flows/embedText.js', () => ({
  embedTextFlow: vi.fn(async () => ({ values: [0, 0, 0] })),
}));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({ arbitrateCanonFlow: vi.fn() }));
vi.mock('../../src/flows/arbitrateProductForm.js', () => ({ arbitrateProductFormFlow: vi.fn() }));

// Spread the actual module rather than listing `logger` alone — the adapters in
// this graph import other things from `firebase-functions`.
const mockLoggerWarn = vi.fn();
vi.mock('firebase-functions', async (importActual) => ({
  ...(await importActual<object>()),
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));

const mockReportServerError = vi.fn();
vi.mock('../../src/observability/reportServerError.js', () => ({
  reportServerError: (...args: unknown[]) => mockReportServerError(...(args as [])),
  reportFlowError: vi.fn(async () => undefined),
}));

const { canonicaliseRecipeIngredientsFlow } =
  await import('../../src/flows/canonicaliseRecipeIngredients.js');

// The read runs once, before the per-item loop, so an empty batch exercises it
// exactly as a populated one does — without dragging arbitration and canon writes
// into a test about a single read.
const emptyBatch = { items: [] } as never;

beforeEach(() => {
  collections.clear();
  failingReads.clear();
  mockLoggerWarn.mockClear();
  mockReportServerError.mockClear();
});

describe('canonicaliseRecipeIngredients — the failed productForms read is announced', () => {
  it('logs and reports a StorageError when the productForms read fails', async () => {
    failingReads.add('productForms');

    // The degrade is unchanged: the batch still completes rather than throwing.
    await expect(canonicaliseRecipeIngredientsFlow(emptyBatch)).resolves.toEqual([]);

    const warnings = mockLoggerWarn.mock.calls.filter((c) =>
      String(c[0]).includes('productForms read failed'),
    );
    expect(warnings).toHaveLength(1);
    // The log line names BOTH things the batch loses, not just the guard.
    expect(String(warnings[0]![0])).toContain('form binding');
    expect(String(warnings[0]![0])).toContain('synonym guard');

    expect(mockReportServerError).toHaveBeenCalledTimes(1);
    const [reported, category] = mockReportServerError.mock.calls[0]!;
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe(
      'productForms read failed — recipe-batch form binding and synonym guard disabled',
    );
    expect(category).toBe('StorageError');
  });

  it('stays silent when the productForms table is merely empty', async () => {
    await expect(canonicaliseRecipeIngredientsFlow(emptyBatch)).resolves.toEqual([]);

    // An empty table is a normal state (fresh environment, emulator). This is the
    // assertion that fails if the split is ever collapsed back into "announce
    // whenever forms is empty".
    expect(
      mockLoggerWarn.mock.calls.filter((c) => String(c[0]).includes('productForms read failed')),
    ).toHaveLength(0);
    expect(mockReportServerError).not.toHaveBeenCalled();
  });
});
