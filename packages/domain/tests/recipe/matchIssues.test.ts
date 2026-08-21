import { describe, it, expect } from 'vitest';
import { ingredientMatchIssue, recipeMatchIssueCount } from '../../src/index.js';
import type { CanonItem, Ingredient, ProductForm, Recipe } from '../../src/index.js';

// What earns a pip is a line that LOOKS matched and is not. The cases below are
// the boundary: the two silent failures on one side, and on the other the two
// states people reach for first — a never-matched line and a form that resolves
// somewhere else — which must not be counted and must not be mistaken for each
// other.

const LIME: CanonItem = {
  id: 'canon-lime',
  schemaVersion: 5,
  name: 'lime',
  synonyms: [],
  aisleId: null,
  thumbnail: null,
  needs_approval: false,
  shoppingBehavior: 'needed',
  unit: 'count',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

const FLOUR: CanonItem = { ...LIME, id: 'canon-flour', name: 'plain flour', unit: 'g' };

// Sold by the count (a bulb), which is what makes a grams line look mismatched.
// Named as #865 renamed it, so a line reading plain "garlic" no longer names its
// canon exactly — which is the shape every stale clove line in the library takes.
const GARLIC_BULBS: CanonItem = {
  ...LIME,
  id: 'canon-garlic',
  name: 'Garlic Bulbs',
  synonyms: ['garlic', 'garlic clove'],
  unit: 'count',
};

// Sold by the count and carrying no form at all, and none should ever be minted
// for it (issue #865). The bay-leaf shape: out of the marker's reach entirely.
const BAY_LEAVES: CanonItem = {
  ...LIME,
  id: 'canon-bay',
  name: 'Bay Leaves',
  unit: 'count',
};

const WHOLE_CHICKEN: CanonItem = {
  ...LIME,
  id: 'canon-chicken',
  name: 'Whole Chicken',
  unit: 'count',
};

const LIME_JUICE: ProductForm = {
  id: 'form-lime-juice',
  schemaVersion: 1,
  matchers: [],
  parentCanonId: 'canon-lime',
  label: 'Lime juice',
  yield: { formUnit: 'ml', amountPerParent: 30 },
  updatedAt: '2026-08-19T00:00:00.000Z',
};

// A form of the same parent that this line's text does NOT name. Its whole job
// in these tests is to put canon Lime within the marker's reach without
// bridging the juice line, exactly as the live `Lemon zest` form does for the
// three `fresh lemon juice` lines the pip must keep flagging (issue #855).
const LIME_ZEST: ProductForm = {
  ...LIME_JUICE,
  id: 'form-lime-zest',
  label: 'Lime zest',
  yield: { formUnit: 'g', amountPerParent: 5 },
};

const GARLIC_CLOVE: ProductForm = {
  ...LIME_JUICE,
  id: 'form-garlic-clove',
  parentCanonId: 'canon-garlic',
  label: 'Garlic clove',
  yield: { formUnit: 'count', amountPerParent: 10 },
};

const CHICKEN_BREAST: ProductForm = {
  ...LIME_JUICE,
  id: 'form-chicken-breast',
  parentCanonId: 'canon-chicken',
  label: 'Chicken breast',
  yield: { formUnit: 'count', amountPerParent: 2 },
};

function ing(over: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    rawText: 'Juice of 2 limes',
    parsed: {
      quantity: { type: 'single', value: 60 },
      unit: 'ml',
      item: 'lime juice',
      preparation: [],
      notes: null,
      displayText: '2 limes',
    },
    canonId: 'canon-lime',
    matchState: 'matched',
    isOptional: false,
    firstUsedInStepId: null,
    ...over,
  };
}

const byId = (items: CanonItem[]) => new Map(items.map((c) => [c.id, c]));

describe('ingredientMatchIssue', () => {
  it('is clean when a form bridges the metric line to a by-the-count canon', () => {
    expect(ingredientMatchIssue(ing(), byId([LIME]), [LIME_JUICE])).toBeNull();
  });

  it('flags a by-the-count canon when none of its forms cover this line', () => {
    // The #855 shape: 60ml of a thing sold whole, so the list buys millilitres.
    // Lime is within reach because it already has a zest form; the juice line
    // resolves to none of them, so the bridge is genuinely missing.
    expect(ingredientMatchIssue(ing(), byId([LIME]), [LIME_ZEST])).toBe('missing_form');
  });

  it('does not accept a form that bridges to some other parent', () => {
    const elsewhere = { ...LIME_JUICE, parentCanonId: 'canon-lemon' };
    expect(ingredientMatchIssue(ing(), byId([LIME]), [LIME_ZEST, elsewhere])).toBe('missing_form');
  });

  it('says nothing when the matched canon has no product form of its own', () => {
    // The #867 false positive, and the bulk of it: Bay Leaves, Red Chilli,
    // Fennel, Celery, Daikon Radish, Red Onion, Lettuce and Soft Burger Bun are
    // all sold by the count with no form at all, and #865 taught the pipeline
    // that none should ever be minted for them. Any gram-measured line whose
    // wording merely differs from the canon's name used to read as a missing
    // form — a demand no re-match could ever satisfy.
    const bayLeaf = ing({
      rawText: '2 bay leaves',
      canonId: 'canon-bay',
      parsed: {
        quantity: { type: 'single', value: 1 },
        unit: 'g',
        item: 'bay leaf',
        preparation: [],
        notes: null,
        displayText: '2',
      },
    });
    // Forms exist in the library — just none belonging to THIS canon.
    expect(ingredientMatchIssue(bayLeaf, byId([BAY_LEAVES]), [LIME_JUICE, LIME_ZEST])).toBeNull();
  });

  it('says nothing when the line names the canon item itself, forms or no forms', () => {
    // A thing given by weight is that thing, measured — not a form of itself, and
    // `arbitrateProductForm` rightly answers `modifier_kind: "none"` and mints
    // nothing. Whole Chicken carries breast/thigh/drumstick forms, so the
    // has-a-form guard alone would flag this line; the name test is what keeps it
    // quiet, which is why both guards are needed and neither is redundant.
    const byWeight = ing({
      canonId: 'canon-chicken',
      rawText: '1.6 kg whole chicken',
      parsed: {
        quantity: { type: 'single', value: 1600 },
        unit: 'g',
        item: 'whole chicken',
        preparation: [],
        notes: null,
        displayText: '1.6 kg',
      },
    });
    expect(ingredientMatchIssue(byWeight, byId([WHOLE_CHICKEN]), [CHICKEN_BREAST])).toBeNull();
  });

  it('is not fooled by plurals or casing when comparing the two names', () => {
    // normaliseName folds both sides, so "Carrots" against canon "Carrot" is the
    // same thing — the single commonest shape of the false positive above.
    const carrots = ing({
      rawText: '150g carrots, diced',
      canonId: 'canon-carrot',
      parsed: {
        quantity: { type: 'single', value: 150 },
        unit: 'g',
        item: 'Carrots',
        preparation: ['diced'],
        notes: null,
        displayText: null,
      },
    });
    const carrot: CanonItem = { ...LIME, id: 'canon-carrot', name: 'carrot', unit: 'count' };
    const baton: ProductForm = {
      ...LIME_JUICE,
      id: 'form-carrot-baton',
      parentCanonId: 'canon-carrot',
      label: 'Carrot baton',
    };
    // With a form on the canon, only the name test can be doing the silencing.
    expect(ingredientMatchIssue(carrots, byId([carrot]), [baton])).toBeNull();
  });

  it('still flags a component that names something other than its parent', () => {
    // Neither guard may blunt the case the marker exists for: "lime juice" is not
    // "lime", so a form is genuinely the missing bridge (issue #855).
    expect(ingredientMatchIssue(ing(), byId([LIME]), [LIME_ZEST])).toBe('missing_form');
    // The stale clove line, and the reason #865 renamed the canon: the parse threw
    // the clove away and flattened to grams, so it can no longer reach the
    // `garlic clove → Garlic Bulbs` form that already exists and the list cannot
    // say how many bulbs to buy. Thirteen live lines take this shape and every one
    // of them must keep its pip.
    const staleClove = ing({
      rawText: '2 cloves garlic, crushed',
      canonId: 'canon-garlic',
      parsed: {
        quantity: { type: 'single', value: 6 },
        unit: 'g',
        item: 'garlic',
        preparation: ['crushed'],
        notes: null,
        displayText: '2 cloves',
      },
    });
    expect(ingredientMatchIssue(staleClove, byId([GARLIC_BULBS]), [GARLIC_CLOVE])).toBe(
      'missing_form',
    );
  });

  it('flags a canon item that has been deleted or merged away', () => {
    expect(ingredientMatchIssue(ing(), byId([]), [LIME_JUICE])).toBe('dangling_canon');
  });

  it('says nothing about a line that was never matched — that is visible already', () => {
    const never = ing({ canonId: null, matchState: 'pending' });
    expect(ingredientMatchIssue(never, byId([LIME]), [])).toBeNull();
  });

  it('says nothing when the canon is bought by weight — no form is called for', () => {
    const flourLine = ing({
      canonId: 'canon-flour',
      parsed: {
        quantity: { type: 'single', value: 200 },
        unit: 'g',
        item: 'plain flour',
        preparation: [],
        notes: null,
        displayText: null,
      },
    });
    expect(ingredientMatchIssue(flourLine, byId([FLOUR]), [])).toBeNull();
  });

  it('says nothing about a countable line on a by-the-count canon', () => {
    // "2 limes" — no unit, so there is nothing to convert and no form needed.
    const whole = ing({
      rawText: '2 limes',
      parsed: {
        quantity: { type: 'single', value: 2 },
        unit: null,
        item: 'lime',
        preparation: [],
        notes: null,
        displayText: null,
      },
    });
    expect(ingredientMatchIssue(whole, byId([LIME]), [])).toBeNull();
  });
});

describe('recipeMatchIssueCount', () => {
  const recipe = (items: Ingredient[]): Recipe =>
    ({ ingredients: [{ id: 'g1', name: null, items }] }) as Recipe;

  it('counts every silently wrong line across the groups', () => {
    const count = recipeMatchIssueCount(
      recipe([ing({ id: 'a' }), ing({ id: 'b' }), ing({ id: 'c', canonId: null })]),
      byId([LIME]),
      [LIME_ZEST],
    );
    expect(count).toBe(2);
  });

  it('is zero for an entry with no ingredients at all', () => {
    expect(recipeMatchIssueCount({ ingredients: [] } as unknown as Recipe, byId([]), [])).toBe(0);
  });
});
