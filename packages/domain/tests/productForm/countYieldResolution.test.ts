import { describe, it, expect } from 'vitest';
import { formParentCount, maxCountWinners } from '@salt/domain';
import type { ProductForm } from '@salt/domain';

// Regression lock for the count-yield resolution path (#501 egg/chicken cases).
//
// A recipe ingredient parsed as a bare count carries `unit: null`; the client
// (recipeService.formCountFor) reads `ingUnit = ing.parsed.unit ?? 'count'`, so a
// count ingredient resolves against a `formUnit: 'count'` product form. This test
// pins the PURE resolution layer that client path delegates to —
// `formParentCount` (per-ingredient parent count) then `maxCountWinners`
// (the WITHIN-recipe collapse) — so the shopping-list outcome cannot silently
// regress:
//   "3 egg whites"                              → Free Range Egg ×3
//   "2 egg yolks" + "3 egg whites" in ONE recipe → one Free Range Egg ×3 (MAX, not 5)
//   "6 chicken thighs" (2 per bird)             → Whole Chicken ×3
//
// SCOPE — `maxCountWinners` is WITHIN-RECIPE ONLY. It collapses the several forms
// of one parent that a SINGLE recipe demands down to one surviving row (juice and
// zest of a lime become one lime line), and it returns the winning entry's INDEX,
// not a count. It is NOT the cross-recipe rule: aggregating one parent's demand
// across the whole list is `aggregateParentCount`'s job (#518), where the SAME
// form in different recipes SUMS and only DISTINCT forms MAX — locked in
// productForm/aggregateParentCount.test.ts. The downstream buildSubtotals
// bucketing (Σwhole + MAX-form in one 'count' row, "×3 not 350 g") is locked in
// shoppingList/groupItemsByAisle.test.ts.

// One egg gives one lot of whites and one lot of yolks → a 1:1 count yield.
const eggWhite: ProductForm = {
  id: 'pf-egg-white',
  schemaVersion: 1,
  matchers: ['egg white', 'egg whites'],
  parentCanonId: 'canon-egg',
  label: 'egg white',
  yield: { formUnit: 'count', amountPerParent: 1 },
  updatedAt: '',
};

const eggYolk: ProductForm = {
  ...eggWhite,
  id: 'pf-egg-yolk',
  matchers: ['egg yolk', 'egg yolks'],
  label: 'egg yolk',
  yield: { formUnit: 'count', amountPerParent: 1 },
};

// A whole chicken yields ~2 thighs → a count yield with amountPerParent > 1. This
// is the ratio case the existing count-yield fixtures (all 1-per-parent) never
// exercised: 6 thighs must buy 3 birds, not 6.
const chickenThigh: ProductForm = {
  id: 'pf-chicken-thigh',
  schemaVersion: 1,
  matchers: ['chicken thigh', 'chicken thighs'],
  parentCanonId: 'canon-chicken',
  label: 'chicken thigh',
  yield: { formUnit: 'count', amountPerParent: 2 },
  updatedAt: '',
};

describe('count-yield resolution — formParentCount (count ingredient → parent count)', () => {
  it('a count ingredient against a 1:1 count yield passes the count through (3 egg whites → 3 eggs)', () => {
    expect(formParentCount(3, 'count', eggWhite)).toBe(3);
  });

  it('divides by amountPerParent for a >1 count yield (6 chicken thighs, 2/bird → 3 birds)', () => {
    // Guards against a regression that summed or passed the raw count through:
    // that would buy 6 birds. It must be 6 / 2 = 3.
    expect(formParentCount(6, 'count', chickenThigh)).toBe(3);
  });

  it('rounds a non-integer bird count up/nearest, never to 0 (3 thighs, 2/bird → 2)', () => {
    expect(formParentCount(3, 'count', chickenThigh)).toBe(2); // 1.5 → 2
    expect(formParentCount(1, 'count', chickenThigh)).toBe(1); // 0.5 → 1, never 0
  });

  it('still degrades to null when the ingredient unit is not a count (a g of egg has no count yield)', () => {
    // The count→count rollup gate is the unit agreement, not a new gate: a mass
    // ingredient against a count yield returns null (identity-only), not a guess.
    expect(formParentCount(100, 'g', eggWhite)).toBeNull();
  });
});

describe('count-yield resolution — maxCountWinners (within-recipe collapse: MAX, not sum)', () => {
  it('distinct forms of one parent in a recipe collapse by MAX, not sum (2 yolks + 3 whites → 3 eggs, not 5)', () => {
    // The winning entry is the LATER one (index 1), which is the strongest proof
    // the collapse is MAX-by-value: keep-first would pick the count-2 yolk row and
    // sum-behaviour would report 5. One egg yields BOTH its white and its yolk, so
    // the shopper buys MAX(2, 3) = 3.
    //
    // MAX is right HERE because the two entries are DISTINCT forms (yolk vs white)
    // of one parent. It is not a statement about recipes: the same form demanded by
    // two recipes sums instead, one layer up in `aggregateParentCount`.
    const yolks = formParentCount(2, 'count', eggYolk)!; // 2 egg yolks → 2
    const whites = formParentCount(3, 'count', eggWhite)!; // 3 egg whites → 3
    const winners = maxCountWinners([
      { parentCanonId: eggYolk.parentCanonId, count: yolks },
      { parentCanonId: eggWhite.parentCanonId, count: whites },
    ]);
    expect(winners.get('canon-egg')).toBe(1); // the count-3 white row wins
    expect(winners.size).toBe(1); // one merged parent, not two rows
  });

  it('the chicken ratio survives the within-recipe MAX (6 thighs→3 vs 2 drumsticks→1 = 3 birds)', () => {
    // Again distinct forms (thigh vs drumstick) of one bird → MAX. The ratio yield
    // (2 thighs/bird) must survive the collapse: the winner is the count-3 entry.
    const thighs = formParentCount(6, 'count', chickenThigh)!; // 3
    const drumsticks = 1;
    const winners = maxCountWinners([
      { parentCanonId: 'canon-chicken', count: thighs },
      { parentCanonId: 'canon-chicken', count: drumsticks },
    ]);
    expect(winners.get('canon-chicken')).toBe(0); // the count-3 thigh row wins
    expect(winners.size).toBe(1);
  });
});
