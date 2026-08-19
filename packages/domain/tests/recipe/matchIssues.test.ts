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

const LIME_JUICE: ProductForm = {
  id: 'form-lime-juice',
  schemaVersion: 1,
  matchers: [],
  parentCanonId: 'canon-lime',
  label: 'Lime juice',
  yield: { formUnit: 'ml', amountPerParent: 30 },
  updatedAt: '2026-08-19T00:00:00.000Z',
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

  it('flags a by-the-count canon that no form covers', () => {
    // The #855 shape: 60ml of a thing sold whole, so the list buys millilitres.
    expect(ingredientMatchIssue(ing(), byId([LIME]), [])).toBe('missing_form');
  });

  it('does not accept a form that bridges to some other parent', () => {
    const elsewhere = { ...LIME_JUICE, parentCanonId: 'canon-lemon' };
    expect(ingredientMatchIssue(ing(), byId([LIME]), [elsewhere])).toBe('missing_form');
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
      [],
    );
    expect(count).toBe(2);
  });

  it('is zero for an entry with no ingredients at all', () => {
    expect(recipeMatchIssueCount({ ingredients: [] } as unknown as Recipe, byId([]), [])).toBe(0);
  });
});
