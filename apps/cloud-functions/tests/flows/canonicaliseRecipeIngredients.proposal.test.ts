import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── AI-seeded product-form proposals (issue #500, Phase 3) ───────────────────
//
// When a recipe ingredient does NOT resolve to an existing product form, the
// canonicalise flow asks arbitrateProductForm whether it's a non-buyable form of
// a known buyable canon item. A hit is written as a PENDING ProductForm and the
// ingredient binds to the proposed parent in the SAME pass (used-but-flagged).
// This test drives that seam against an in-memory Firestore, stubbing only the AI
// flows. It also asserts idempotency (no duplicate form for a matcher already
// covered) and the degrade path (a `none` answer falls back to normal matching).

const collections = new Map<string, Map<string, Record<string, unknown>>>();

function getCollection(name: string) {
  let c = collections.get(name);
  if (!c) {
    c = new Map();
    collections.set(name, c);
  }
  return c;
}

function seed(name: string, id: string, data: Record<string, unknown>) {
  getCollection(name).set(id, data);
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
          return {
            docs: [...store.entries()].map(([id, data]) => ({ id, data: () => data })),
          };
        },
      };
    },
  }),
}));

// Genkit: defineFlow returns the handler directly.
vi.mock('../../src/genkit.js', () => ({
  ai: { defineFlow: (_cfg: unknown, handler: unknown) => handler },
}));

// Stub the AI flows. arbitrateCanon isn't reached (all ingredients bind to a
// proposed parent or an existing form); embedText backs the canon store.
const mockEmbed = vi.fn(async (_input: { text: string }) => ({ values: [0, 0, 0] }));
const mockArbitrateCanon = vi.fn();
const mockProposal = vi.fn();
vi.mock('../../src/flows/embedText.js', () => ({
  embedTextFlow: (input: { text: string }) => mockEmbed(input),
}));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({
  arbitrateCanonFlow: (input: unknown) => mockArbitrateCanon(input),
}));
vi.mock('../../src/flows/arbitrateProductForm.js', () => ({
  arbitrateProductFormFlow: (input: unknown) => mockProposal(input),
}));

const { canonicaliseRecipeIngredientsFlow } =
  await import('../../src/flows/canonicaliseRecipeIngredients.js');

function canonDoc(id: string, name: string) {
  return {
    id,
    schemaVersion: 5,
    name,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
  };
}

function productFormDocs() {
  return [...getCollection('productForms').values()];
}

function canonDocsNamed(name: string) {
  return [...getCollection('canonItems').values()].filter((d) => d.name === name);
}

beforeEach(() => {
  collections.clear();
  mockEmbed.mockClear();
  mockArbitrateCanon.mockReset();
  mockProposal.mockReset();
  // A buyable parent already in the catalog.
  seed('canonItems', 'canon-nutmeg', canonDoc('canon-nutmeg', 'Nutmeg'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canonicaliseRecipeIngredients — product-form proposals (Phase 3)', () => {
  it('writes a PENDING form and binds the ingredient to the named parent (reuse existing)', async () => {
    // Parent "Nutmeg" already exists — the named parent resolves to it via
    // matchOrCreateBatch (no duplicate canon), and the pending form binds to it.
    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Nutmeg',
      matcher: 'grated nutmeg',
      label: 'Grated nutmeg',
      formUnit: 'g',
      amountPerParent: 12,
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'grated nutmeg' }],
    })) as Array<{ kind: string; value?: { decision: string; item: { id: string } } }>;

    // Bound live to the parent in the same pass.
    expect(result[0]!.kind).toBe('ok');
    expect(result[0]!.value!.decision).toBe('matched');
    expect(result[0]!.value!.item.id).toBe('canon-nutmeg');

    // A pending form was persisted, bound to the reused parent — no dup canon.
    const forms = productFormDocs();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.needs_approval).toBe(true);
    expect(forms[0]!.parentCanonId).toBe('canon-nutmeg');
    expect(forms[0]!.matchers).toEqual(['grated nutmeg']);
    expect(canonDocsNamed('Nutmeg')).toHaveLength(1);
  });

  it('MINTS a new parent canon when the named parent is not in the catalog', async () => {
    // "Lime" is absent — the named parent is minted via matchOrCreateBatch as a
    // fresh needs_approval canon (which the icon/embedding triggers then enrich),
    // and the derivative "lime juice" binds to it. This is the whole Phase 1 point.
    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Lime',
      matcher: 'lime juice',
      label: 'Lime juice',
      formUnit: 'ml',
      amountPerParent: 30,
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'freshly squeezed lime juice' }],
    })) as Array<{ kind: string; value?: { item: { id: string; name: string } } }>;

    // Exactly one new "Lime" canon, minted needs_approval.
    const limes = canonDocsNamed('Lime');
    expect(limes).toHaveLength(1);
    expect(limes[0]!.needs_approval).toBe(true);
    const limeId = limes[0]!.id as string;

    // The derivative bound to the freshly minted parent.
    expect(result[0]!.kind).toBe('ok');
    expect(result[0]!.value!.item.id).toBe(limeId);

    // A pending form points at the minted parent.
    const forms = productFormDocs();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.needs_approval).toBe(true);
    expect(forms[0]!.parentCanonId).toBe(limeId);
  });

  it('mints ONE parent for two forms naming the same parent (in-batch dedupe)', async () => {
    // "lime juice" + "lime zest" both name "Lime". The parent is minted once and
    // the id reused, so only ONE Lime canon appears — with two pending forms.
    mockProposal.mockImplementation((input: { ingredientName: string }) =>
      Promise.resolve(
        input.ingredientName.includes('zest')
          ? {
              kind: 'form',
              parentName: 'Lime',
              matcher: 'lime zest',
              label: 'Lime zest',
              formUnit: 'g',
              amountPerParent: 5,
            }
          : {
              kind: 'form',
              parentName: 'Lime',
              matcher: 'lime juice',
              label: 'Lime juice',
              formUnit: 'ml',
              amountPerParent: 30,
            },
      ),
    );

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'lime juice' }, { rawName: 'lime zest' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    // Exactly one Lime canon, shared by both forms.
    const limes = canonDocsNamed('Lime');
    expect(limes).toHaveLength(1);
    const limeId = limes[0]!.id as string;

    const forms = productFormDocs();
    expect(forms).toHaveLength(2);
    expect(forms.every((f) => f.parentCanonId === limeId)).toBe(true);
    expect(result[0]!.value!.item.id).toBe(limeId);
    expect(result[1]!.value!.item.id).toBe(limeId);
  });

  it('is idempotent — no duplicate form when one already covers the matcher', async () => {
    seed('productForms', 'existing', {
      id: 'existing',
      schemaVersion: 1,
      matchers: ['grated nutmeg'],
      parentCanonId: 'canon-nutmeg',
      label: 'Grated nutmeg',
      yield: { formUnit: 'g', amountPerParent: 12 },
      updatedAt: '',
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'freshly grated nutmeg' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    // Resolved through the EXISTING form; the AI proposal was never consulted.
    expect(mockProposal).not.toHaveBeenCalled();
    expect(result[0]!.value!.item.id).toBe('canon-nutmeg');
    expect(productFormDocs()).toHaveLength(1); // no duplicate written
  });

  it('degrades to normal matching when the AI declines (kind: none)', async () => {
    mockProposal.mockResolvedValue({ kind: 'none' });
    mockArbitrateCanon.mockResolvedValue({ kind: 'no-match' });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'onion' }],
    })) as Array<{ kind: string }>;

    expect(result[0]!.kind).toBe('ok'); // matched-or-created normally
    expect(productFormDocs()).toHaveLength(0); // nothing proposed
  });

  it('never throws when the proposal flow rejects — falls back to matching', async () => {
    mockProposal.mockRejectedValue(new Error('model exploded'));
    mockArbitrateCanon.mockResolvedValue({ kind: 'no-match' });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'onion' }],
    })) as Array<{ kind: string }>;

    expect(result[0]!.kind).toBe('ok');
    expect(productFormDocs()).toHaveLength(0);
  });
});
