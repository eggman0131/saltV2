import { describe, it, expect } from 'vitest';
import { aggregateParentCount } from '@salt/domain';

// Contract lock for the product-form parent-count aggregation (#501, #518).
//
//   Σ(whole/direct) + MAX over forms of ( Σ that form's demand across recipes )
//
// This is the CROSS-RECIPE aggregation, and it is the only place that rule lives.
// (`maxCountWinners` is the separate WITHIN-recipe collapse — see
// productForm/countYieldResolution.test.ts.) The two halves of the rule pull in
// opposite directions on purpose:
//   • SAME form, several recipes → SUM. Two recipes each wanting zest genuinely
//     need more limes.
//   • DIFFERENT forms of one parent → MAX. One egg yields its yolk AND its white
//     at once, so 4 yolks + 3 whites is 4 eggs, not 7.
// Whole/direct purchases SUM on top: a bird bought for its thighs is eaten as
// thighs and can't also be the whole roast.

const empty = { demands: [], legacyFormCounts: [], wholeCounts: [] };

describe('aggregateParentCount — same form across recipes SUMS', () => {
  it('zest 10 g + 15 g against a 5 g/lime yield = 25 g of zest = 5 limes', () => {
    // The headline #518 case. Both recipes want the SAME form (lime zest), so
    // their demand adds: 2 limes' worth + 3 limes' worth = 5 limes. The pre-#518
    // rule MAXed these to 3 and under-bought.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-lime-zest', parentCount: 2 }, // recipe A: 10 g / 5 g-per-lime
          { formId: 'pf-lime-zest', parentCount: 3 }, // recipe B: 15 g / 5 g-per-lime
        ],
      }),
    ).toBe(5);
  });

  it('sums three or more contributions of one form', () => {
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-zest', parentCount: 1 },
          { formId: 'pf-zest', parentCount: 1 },
          { formId: 'pf-zest', parentCount: 2 },
        ],
      }),
    ).toBe(4);
  });
});

describe('aggregateParentCount — distinct forms of one parent MAX', () => {
  it('4 yolks + 3 whites = 4 eggs, not 7 (one egg yields both at once)', () => {
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-egg-yolk', parentCount: 4 },
          { formId: 'pf-egg-white', parentCount: 3 },
        ],
      }),
    ).toBe(4);
  });

  it('MAXes by value, not by order — a later smaller form cannot win', () => {
    // Guards a last-write-wins regression: the count-2 white must not overwrite
    // the count-5 yolk just by arriving second.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-egg-yolk', parentCount: 5 },
          { formId: 'pf-egg-white', parentCount: 2 },
        ],
      }),
    ).toBe(5);
  });

  it('sums WITHIN each form, then maxes ACROSS forms (yolks 2+2 vs whites 3 = 4 eggs)', () => {
    // Both rules at once — the Free Range Egg staging case. Yolks sum to 4 across
    // two recipes; whites stay 3; the parent count is MAX(4, 3) = 4. Getting the
    // order wrong (max first, then sum) would give 3+3=6 or 3.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-egg-yolk', parentCount: 2 }, // recipe A
          { formId: 'pf-egg-yolk', parentCount: 2 }, // recipe B
          { formId: 'pf-egg-white', parentCount: 3 }, // recipe B
        ],
      }),
    ).toBe(4);
  });
});

describe('aggregateParentCount — whole/direct SUMS on top', () => {
  it('adds whole purchases to the form max (2 whole limes + MAX(zest 3) = 5)', () => {
    expect(
      aggregateParentCount({
        ...empty,
        demands: [{ formId: 'pf-lime-zest', parentCount: 3 }],
        wholeCounts: [2],
      }),
    ).toBe(5);
  });

  it('sums several whole contributors among themselves', () => {
    expect(aggregateParentCount({ ...empty, wholeCounts: [2, 3] })).toBe(5);
  });

  it('whole alone (no form demand at all) is just the whole sum', () => {
    expect(aggregateParentCount({ ...empty, wholeCounts: [4] })).toBe(4);
  });

  it('an empty input is 0, not NaN or 1', () => {
    // The Math.max(1, …) floor must apply per-form, never to an absent demand:
    // a parent nobody asked for must not manifest a phantom unit.
    expect(aggregateParentCount(empty)).toBe(0);
  });
});

describe('aggregateParentCount — rounding is deferred to the sum', () => {
  it('6 g + 6 g of zest (4 g/lime) = 12 g = 3 limes, NOT 2 + 2 = 4', () => {
    // THE reason formDemand stores an unrounded fractional parent-count. At a
    // 4 g/lime yield each recipe's 6 g is 1.5 limes, which rounds to 2 on its own
    // row. Summing the ROUNDED values gives 4 limes — one more than needed.
    // Summing raw gives 3.0 → rounds ONCE to 3. Never round per contributor.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-lime-zest', parentCount: 1.5 },
          { formId: 'pf-lime-zest', parentCount: 1.5 },
        ],
      }),
    ).toBe(3);
  });

  it('round-once can also buy FEWER, not just more (1.2 + 1.2 = 2.4 → 2, not 2 + 2 = 4)', () => {
    // The same rule at a 5 g/lime yield: two 6 g demands are 2.4 limes together,
    // so the honest answer is 2. Rounding per contributor would buy 4 — double.
    // Round-once is not a "buy more" rule; it is an "aggregate then decide" rule.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-lime-zest', parentCount: 1.2 },
          { formId: 'pf-lime-zest', parentCount: 1.2 },
        ],
      }),
    ).toBe(2);
  });

  it('rounds the summed demand to nearest (0.5 + 0.9 = 1.4 → 1)', () => {
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-zest', parentCount: 0.5 },
          { formId: 'pf-zest', parentCount: 0.9 },
        ],
      }),
    ).toBe(1);
  });

  it('a positive demand always buys at least one parent, never 0', () => {
    // You cannot buy 0 limes for a pinch of zest. Mirrors formParentCount's floor.
    expect(
      aggregateParentCount({ ...empty, demands: [{ formId: 'pf-zest', parentCount: 0.1 }] }),
    ).toBe(1);
  });

  it('applies the round-once rule per form independently before maxing', () => {
    // Each form rounds on its OWN sum, and only then do the forms max:
    // zest sums 1.5 + 1.5 = 3.0 → 3; juice is a lone 2.4 → 2; MAX(3, 2) = 3.
    // Rounding the grand total instead would conflate two unrelated demands.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-lime-zest', parentCount: 1.5 },
          { formId: 'pf-lime-zest', parentCount: 1.5 },
          { formId: 'pf-lime-juice', parentCount: 2.4 },
        ],
      }),
    ).toBe(3);
  });
});

describe('aggregateParentCount — legacy degrade path (items written pre-#501)', () => {
  it('legacy-only input reproduces the OLD lossy MAX-across-recipes number', () => {
    // An item written before formDemand existed carries only its collapsed,
    // already-rounded per-recipe count; its raw demand is unrecoverable, so MAX
    // is the best available and the existing list keeps rendering exactly what it
    // rendered before. Under the new rule these two would sum to 5 IF they shared
    // a form — but we cannot know that, so they max to 3.
    expect(aggregateParentCount({ ...empty, legacyFormCounts: [2, 3] })).toBe(3);
  });

  it('a lone legacy count passes through unchanged', () => {
    expect(aggregateParentCount({ ...empty, legacyFormCounts: [2] })).toBe(2);
  });

  it('legacy counts still take whole/direct on top', () => {
    expect(aggregateParentCount({ ...empty, legacyFormCounts: [2, 3], wholeCounts: [2] })).toBe(5);
  });

  it('mixed legacy + new: both max into the one form bucket', () => {
    // A list part-written before #501 and part after. The legacy 4 represents the
    // same "max over forms" quantity, just pre-collapsed, so it maxes against the
    // new demands' summed-then-rounded value: zest sums to 3, legacy is 4 → 4.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-lime-zest', parentCount: 2 },
          { formId: 'pf-lime-zest', parentCount: 1 },
        ],
        legacyFormCounts: [4],
      }),
    ).toBe(4);
  });

  it('mixed legacy + new: a summed new form can beat the legacy count', () => {
    // The whole point of #518 — the new per-form sum (2+3 = 5) must be allowed to
    // win over a legacy row's collapsed 3, rather than being capped by it.
    expect(
      aggregateParentCount({
        ...empty,
        demands: [
          { formId: 'pf-lime-zest', parentCount: 2 },
          { formId: 'pf-lime-zest', parentCount: 3 },
        ],
        legacyFormCounts: [3],
      }),
    ).toBe(5);
  });
});
