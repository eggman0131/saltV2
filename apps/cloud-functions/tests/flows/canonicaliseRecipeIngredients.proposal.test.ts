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

  it('runs arbitration on a COLD (empty) canon and mints the parent from nothing', async () => {
    // Issue #512. The flow used to gate arbitration on `candidates.length > 0` —
    // the pre-existing buyable catalog — so with an empty canon no proposal was
    // ever requested and every derivative fell through to plain matching as an
    // ORPHAN canon item. That is exactly the greenfield case #505's parent-minting
    // exists for: fresh environments, e2e/integration setup, a bulk re-import into
    // a cleared canon. Nothing is seeded here, deliberately.
    collections.clear();
    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Lemon',
      matcher: 'lemon juice',
      label: 'Lemon juice',
      formUnit: 'ml',
      amountPerParent: 40,
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'lemon juice' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    // Arbitration was consulted despite there being nothing to offer it.
    expect(mockProposal).toHaveBeenCalledTimes(1);
    expect(mockProposal.mock.calls[0]![0]).toMatchObject({ candidates: [] });

    // The parent was minted, the form written pending, and the derivative bound —
    // no orphan "Lemon Juice" canon.
    const lemons = canonDocsNamed('Lemon');
    expect(lemons).toHaveLength(1);
    expect(canonDocsNamed('Lemon Juice')).toHaveLength(0);
    const forms = productFormDocs();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.parentCanonId).toBe(lemons[0]!.id);
    expect(result[0]!.value!.item.id).toBe(lemons[0]!.id);
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

  it('binds to an existing form with the SAME LABEL instead of minting a broader duplicate', async () => {
    // Issue #854, the whole point of Phase 2. The stored form has been corrected
    // by hand to narrow matchers; the proposal names the same component but with
    // the bare generic word. `resolveProductForm('juice', forms)` is null —
    // "juice" does not contain "lime juice" — so the old one-directional check
    // waved it through and a SECOND "Lime juice" form on the same parent was
    // minted, quietly re-broadening what had just been fixed. The label check
    // sees it.
    seed('canonItems', 'canon-lime', canonDoc('canon-lime', 'Lime'));
    seed('productForms', 'a5a5cfd2', {
      id: 'a5a5cfd2',
      schemaVersion: 1,
      matchers: ['lime juice', 'fresh lime juice'],
      parentCanonId: 'canon-lime',
      label: 'Lime juice',
      yield: { formUnit: 'ml', amountPerParent: 30 },
      needs_approval: false,
      updatedAt: '',
    });

    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Lime',
      matcher: 'juice',
      label: 'Lime juice',
      formUnit: 'ml',
      amountPerParent: 30,
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'the juice of 2 limes' }],
    })) as Array<{ kind: string; value?: { decision: string; item: { id: string } } }>;

    // Arbitration DID run (the ingredient name did not resolve to the form), and
    // its proposal was absorbed by the existing form rather than minted beside it.
    expect(mockProposal).toHaveBeenCalledTimes(1);
    const forms = productFormDocs();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.id).toBe('a5a5cfd2');
    expect(forms[0]!.matchers).toEqual(['lime juice', 'fresh lime juice']);
    // Still approved — the needs-approval badge does not increment for a
    // component an approved form already covers.
    expect(forms[0]!.needs_approval).toBe(false);

    // And the ingredient bound live to that form's parent.
    expect(result[0]!.kind).toBe('ok');
    expect(result[0]!.value!.decision).toBe('matched');
    expect(result[0]!.value!.item.id).toBe('canon-lime');
    // No orphan canon minted for the derivative.
    expect(canonDocsNamed('Juice')).toHaveLength(0);
  });

  it('still mints when the proposal names a component no existing form is called', async () => {
    // The dedupe is EQUALITY on the label, not a blanket "already have a form on
    // this parent" — a genuinely different component of the same parent is still
    // a new form.
    seed('canonItems', 'canon-lime', canonDoc('canon-lime', 'Lime'));
    seed('productForms', 'a5a5cfd2', {
      id: 'a5a5cfd2',
      schemaVersion: 1,
      matchers: ['lime juice', 'fresh lime juice'],
      parentCanonId: 'canon-lime',
      label: 'Lime juice',
      yield: { formUnit: 'ml', amountPerParent: 30 },
      needs_approval: false,
      updatedAt: '',
    });

    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Lime',
      matcher: 'lime zest',
      label: 'Lime zest',
      formUnit: 'g',
      amountPerParent: 5,
    });

    await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'lime zest' }],
    });

    const forms = productFormDocs();
    expect(forms).toHaveLength(2);
    expect(forms.map((f) => f.label).sort()).toEqual(['Lime juice', 'Lime zest']);
    expect(forms.every((f) => f.parentCanonId === 'canon-lime')).toBe(true);
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
