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

function canonDoc(id: string, name: string, synonyms: string[] = []) {
  return {
    id,
    schemaVersion: 5,
    name,
    synonyms,
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
  seed('canonItems', 'canon-garlic', canonDoc('canon-garlic', 'Garlic Bulb'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canonicaliseRecipeIngredients — product-form proposals (Phase 3)', () => {
  it('writes a PENDING form and binds the ingredient to the named parent (reuse existing)', async () => {
    // Parent "Garlic Bulb" already exists — the named parent resolves to it via
    // matchOrCreateBatch (no duplicate canon), and the pending form binds to it.
    // A clove is a genuine derivative: it has its own name for what it IS, so it
    // clears `proposalRejectionReason`. A preparation ("grated nutmeg") would
    // not, and deliberately so — see that function.
    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Garlic Bulb',
      matcher: 'garlic clove',
      label: 'Garlic clove',
      formUnit: 'count',
      amountPerParent: 10,
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'garlic clove' }],
    })) as Array<{ kind: string; value?: { decision: string; item: { id: string } } }>;

    // Bound live to the parent in the same pass.
    expect(result[0]!.kind).toBe('ok');
    expect(result[0]!.value!.decision).toBe('matched');
    expect(result[0]!.value!.item.id).toBe('canon-garlic');

    // A pending form was persisted, bound to the reused parent — no dup canon.
    const forms = productFormDocs();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.needs_approval).toBe(true);
    expect(forms[0]!.parentCanonId).toBe('canon-garlic');
    expect(forms[0]!.matchers).toEqual(['garlic clove']);
    expect(canonDocsNamed('Garlic Bulb')).toHaveLength(1);
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
      matchers: ['garlic clove'],
      parentCanonId: 'canon-garlic',
      label: 'Garlic clove',
      yield: { formUnit: 'count', amountPerParent: 10 },
      updatedAt: '',
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'finely chopped garlic cloves' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    // Resolved through the EXISTING form; the AI proposal was never consulted.
    expect(mockProposal).not.toHaveBeenCalled();
    expect(result[0]!.value!.item.id).toBe('canon-garlic');
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

  // ── The label dedupe is scoped to the parent the proposal named (issue #1127) ─
  //
  // The pair below states one claim and its boundary, and neither half is
  // decoration: the first is the fix, the second is the part of the reported
  // symptom the fix does NOT reach. Read them together before widening either.

  it('mints on the NAMED parent instead of binding to a same-labelled form on another one', async () => {
    // "Stock" is stored on the beef cube. A recipe asks for chicken bouillon and
    // the model proposes `Stock` on the chicken cube. Before #1127 the covering
    // check compared labels across the WHOLE form table, so the proposal was
    // absorbed by the beef form and the ingredient bound to beef — the shopping
    // list said buy beef cubes. Beef stock and chicken stock are two things.
    //
    // The two parents share the word "Stock" ON PURPOSE (issue #1180): the label
    // rule added there asks only that a label share SOME word with its parent,
    // not that the word distinguishes it — so `Stock` clears that rule on both
    // parents and this cross-parent hazard is still reachable. That is the
    // stated boundary of the write-side rule, exercised rather than described.
    seed('canonItems', 'canon-beef', canonDoc('canon-beef', 'Beef Stock Cube'));
    seed('canonItems', 'canon-chicken', canonDoc('canon-chicken', 'Chicken Stock Cube'));
    seed('productForms', 'beef-stock', {
      id: 'beef-stock',
      schemaVersion: 1,
      matchers: ['beef stock'],
      parentCanonId: 'canon-beef',
      label: 'Stock',
      yield: { formUnit: 'ml', amountPerParent: 500 },
      needs_approval: false,
      updatedAt: '',
    });

    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Chicken Stock Cube',
      matcher: 'chicken bouillon',
      label: 'Stock',
      formUnit: 'ml',
      amountPerParent: 500,
    });

    // The ingredient text deliberately shares no token-run with the stored
    // form's label or matchers, so it reaches arbitration rather than being
    // claimed earlier — see the boundary test below for why that matters.
    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: '500 ml chicken bouillon' }],
    })) as Array<{ kind: string; value?: { decision: string; item: { id: string } } }>;

    expect(mockProposal).toHaveBeenCalledTimes(1);

    // A second Stock form was minted — on chicken, not beside the beef one.
    const forms = productFormDocs();
    expect(forms).toHaveLength(2);
    const minted = forms.find((f) => f.id !== 'beef-stock')!;
    expect(minted.label).toBe('Stock');
    expect(minted.parentCanonId).toBe('canon-chicken');
    // The beef form is untouched.
    expect(forms.find((f) => f.id === 'beef-stock')!.parentCanonId).toBe('canon-beef');

    // And the ingredient bound to the parent the recipe actually named.
    expect(result[0]!.kind).toBe('ok');
    expect(result[0]!.value!.decision).toBe('matched');
    expect(result[0]!.value!.item.id).toBe('canon-chicken');
    // No duplicate canon minted on the way.
    expect(canonDocsNamed('Chicken Stock Cube')).toHaveLength(1);
  });

  it('still dedupes by label on a parent minted EARLIER IN THE SAME BATCH', async () => {
    // The edge the parent scoping could have broken. Scoping the label check to a
    // parent id means the caller has to know that id without minting one — and
    // for a brand-new parent there is nothing in the canon list to look it up in.
    // The in-batch mint cache is the second source, so two ingredients naming the
    // same component of the same NEW parent still produce one form, not two
    // (issue #854's dedupe, which #1127 must not cost).
    mockProposal.mockImplementation((input: { ingredientName: string }) =>
      Promise.resolve({
        kind: 'form',
        parentName: 'Lime',
        matcher: input.ingredientName.includes('skin')
          ? 'outer skin of lime'
          : 'grated peel of lime',
        // Names its parent, as issue #1180's write-side rule now requires; the
        // dedupe under test is unaffected by which label it is, only by the two
        // proposals agreeing on it.
        label: 'Lime zest',
        formUnit: 'g',
        amountPerParent: 5,
      }),
    );

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'grated peel of 1 lime' }, { rawName: 'outer skin of 1 lime' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    expect(mockProposal).toHaveBeenCalledTimes(2);
    const limes = canonDocsNamed('Lime');
    expect(limes).toHaveLength(1);
    const limeId = limes[0]!.id as string;

    // One Zest form on the minted parent — the second proposal was absorbed.
    const forms = productFormDocs();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.label).toBe('Lime zest');
    expect(forms[0]!.parentCanonId).toBe(limeId);
    expect(result[0]!.value!.item.id).toBe(limeId);
    expect(result[1]!.value!.item.id).toBe(limeId);
  });

  it('re-checks the AUTHORITATIVE parent before minting when the exact-name lookup misses it (#1181 review, finding B1)', async () => {
    // The proposal's parentName need not be a canon NAME verbatim — the model is
    // told the candidate list is a preference, not a requirement. "Green Onions"
    // here is a stored SYNONYM of "Spring Onions", not its name, so
    // `namedParentCanonId`'s exact-normalised-name lookup misses it and the
    // covering check answers null even though the parent — and a same-labelled
    // form already on it — exist. Before this fix that null was final:
    // `resolveParentCanonId` then resolved the SAME parent via the synonym (the
    // full five-stage matcher, wider than the exact-name lookup) and minted a
    // second "Green tops" form beside the one already there, regressing #854.
    seed(
      'canonItems',
      'canon-spring-onions',
      canonDoc('canon-spring-onions', 'Spring Onions', ['green onions']),
    );
    seed('productForms', 'green-tops', {
      id: 'green-tops',
      schemaVersion: 1,
      matchers: ['spring onion tops'],
      parentCanonId: 'canon-spring-onions',
      label: 'Green tops',
      yield: { formUnit: 'g', amountPerParent: 20 },
      needs_approval: false,
      updatedAt: '',
    });

    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Green Onions',
      matcher: 'tops',
      label: 'Green tops',
      formUnit: 'g',
      amountPerParent: 20,
    });

    // Shares no token-run with the stored form's label or matcher, so it
    // reaches arbitration instead of being claimed by resolveProductForm first.
    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'chopped scallion tops' }],
    })) as Array<{ kind: string; value?: { decision: string; item: { id: string } } }>;

    expect(mockProposal).toHaveBeenCalledTimes(1);

    // No duplicate form minted — bound to the form already stored on the parent.
    const forms = productFormDocs();
    expect(forms).toHaveLength(1);
    expect(forms[0]!.id).toBe('green-tops');

    expect(result[0]!.kind).toBe('ok');
    expect(result[0]!.value!.decision).toBe('matched');
    expect(result[0]!.value!.item.id).toBe('canon-spring-onions');
  });

  it('a bare-noun label does not claim an ingredient naming a different parent', async () => {
    // Issue #1180's headline reproduction, at site A — the PRE-ARBITRATION bind,
    // which fires ~130 lines before anything #1127 changed and is what owned the
    // reported symptom. `Zest` filed under Lemon is a global, parent-blind
    // matching phrase, because `resolveProductForm` matches a form's label on
    // equal terms with its matchers (issue #818, correctly). Before #1180
    // `normaliseName('zest of 1 lime')` → `'zest of lime'` contains the token
    // `zest`, the Lemon form claimed the line, `mockProposal` was never called,
    // and the shopping list said buy lemons.
    //
    // Now the phrase `zest` is CONTESTED: the text also names canon `Lime`, on a
    // token the phrase does not cover. So no form claims the line, it reaches
    // arbitration, and the proposal mints on the parent the model actually named.
    //
    // This test is the flow-level half of #1127's own DoD bullet 1, which
    // #1127's deliverables could not reach. It goes red if the contested rule is
    // removed, if `candidates` stops being threaded into the site-A call, or if
    // that call is moved above the canon read that fills `candidates`.
    seed('canonItems', 'canon-lemon', canonDoc('canon-lemon', 'Lemon'));
    seed('canonItems', 'canon-lime', canonDoc('canon-lime', 'Lime'));
    seed('productForms', 'lemon-zest', {
      id: 'lemon-zest',
      schemaVersion: 1,
      matchers: ['lemon zest'],
      parentCanonId: 'canon-lemon',
      label: 'Zest',
      yield: { formUnit: 'g', amountPerParent: 5 },
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

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'zest of 1 lime' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    // Arbitration ran, and the new form was minted on Lime, not Lemon.
    expect(mockProposal).toHaveBeenCalledTimes(1);
    const forms = productFormDocs();
    expect(forms).toHaveLength(2);
    expect(forms.find((f) => f.label === 'Lime zest')?.parentCanonId).toBe('canon-lime');
    expect(result[0]!.value!.item.id).toBe('canon-lime');
  });

  it('mints nothing when the proposed label does not name its parent', async () => {
    // Issue #1180, mechanism 2 — the write path, closing the hole the read-path
    // fix leaves open. `Zest` is a perfectly coherent proposal and a good
    // matcher, but the label names no parent, and a form's label is matching
    // input (#818). Rejected before the write, so the ingredient falls through
    // to ordinary canon matching — the same degrade the two older rejection
    // reasons already use.
    seed('canonItems', 'canon-lime', canonDoc('canon-lime', 'Lime'));
    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Lime',
      matcher: 'lime zest',
      label: 'Zest',
      formUnit: 'g',
      amountPerParent: 5,
    });

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'zest of 1 lime' }],
    })) as Array<{
      kind: string;
      value?: { decision: string; item: { id: string; name: string } };
    }>;

    expect(mockProposal).toHaveBeenCalledTimes(1);
    expect(productFormDocs()).toHaveLength(0);
    // Fell through to matchOrCreateBatch, which owns the answer from here.
    expect(result[0]!.kind).toBe('ok');
  });

  it('site B — a contested proposal matcher no longer counts as already covered', async () => {
    // The other cross-parent `resolveProductForm` call: the proposal COVERING
    // check. With the same bare `Zest` on Lemon stored, a `Lime zest` proposal
    // carrying matcher `lime zest` used to resolve to the Lemon form (`zest`
    // matches inside `lime zest`), so the flow decided the proposal was already
    // covered and bound the line to Lemon — minting nothing. Contested now, so
    // the covering check answers null and the right form is minted on Lime.
    //
    // Distinct from the case above: here arbitration is REACHED either way (the
    // ingredient text shares no phrase with the stored form), and only the
    // covering check's answer differs.
    seed('canonItems', 'canon-lemon', canonDoc('canon-lemon', 'Lemon'));
    seed('canonItems', 'canon-lime', canonDoc('canon-lime', 'Lime'));
    seed('productForms', 'lemon-zest', {
      id: 'lemon-zest',
      schemaVersion: 1,
      matchers: ['lemon zest'],
      parentCanonId: 'canon-lemon',
      label: 'Zest',
      yield: { formUnit: 'g', amountPerParent: 5 },
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

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'grated peel of lime' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    expect(mockProposal).toHaveBeenCalledTimes(1);
    const forms = productFormDocs();
    expect(forms).toHaveLength(2);
    expect(forms.find((f) => f.label === 'Lime zest')?.parentCanonId).toBe('canon-lime');
    expect(result[0]!.value!.item.id).toBe('canon-lime');
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

  // ── An exact canon hit outranks form arbitration ──────────────────────────
  //
  // Everything above this point is about proposing forms for text nothing owns.
  // These two are the opposite case: a person has already said what the text
  // means, and the model must not be asked to reconsider. Before this, EVERY
  // ingredient no existing form claimed went to arbitration whatever the canon
  // list said, so a proposal could be minted over a curated synonym — and minted
  // again on the next pass after the operator deleted it. Deleting an over-eager
  // form and recording a synonym is how a person corrects this pipeline, so the
  // correction has to survive the next run.

  it('skips form arbitration entirely when a stored SYNONYM names the ingredient', async () => {
    seed('canonItems', 'canon-bay', canonDoc('canon-bay', 'Bay Leaves', ['bay leaf']));

    const result = (await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'bay leaf' }],
    })) as Array<{ kind: string; value?: { item: { id: string } } }>;

    // The model was never consulted — no AI call, and no form to delete later.
    expect(mockProposal).not.toHaveBeenCalled();
    expect(productFormDocs()).toHaveLength(0);
    expect(result[0]!.kind).toBe('ok');
    expect(result[0]!.value!.item.id).toBe('canon-bay');
  });

  it('still arbitrates when the canon match is only a RESEMBLANCE, not an exact name', async () => {
    // The narrowness is the point. "garlic clove" does not exactly name Garlic
    // Bulbs and is not one of its synonyms — it merely looks a bit like it — so
    // the derivative still reaches arbitration and can get the form it needs.
    // Were this check fuzzy, every derivative would be swallowed by its parent
    // and no form would ever be proposed again. The parent is the one seeded in
    // beforeEach, so the ingredient is the only new thing here.
    mockProposal.mockResolvedValue({
      kind: 'form',
      parentName: 'Garlic Bulb',
      matcher: 'garlic clove',
      label: 'Garlic clove',
      formUnit: 'count',
      amountPerParent: 10,
    });

    await (canonicaliseRecipeIngredientsFlow as Function)({
      items: [{ rawName: 'garlic clove' }],
    });

    expect(mockProposal).toHaveBeenCalledTimes(1);
    expect(productFormDocs()).toHaveLength(1);
  });
});
