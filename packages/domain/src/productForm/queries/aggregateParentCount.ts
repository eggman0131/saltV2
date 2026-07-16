import type { FormDemand } from '../entities/ProductForm.js';

export interface ParentCountInput {
  // Every product-form contributor's demand on this parent, across ALL recipes
  // on the list (issue #501). Demands sharing a `formId` sum; distinct formIds max.
  readonly demands: readonly FormDemand[];
  // Pre-#501 contributors: items written before `formDemand` existed carry only a
  // collapsed per-recipe parent count and no per-form breakdown, so their raw
  // demand is unrecoverable. They keep the old lossy MAX-across-recipes rule —
  // the degrade path, so an existing list keeps rendering its old number.
  readonly legacyFormCounts: readonly number[];
  // Whole/direct purchases of the parent as itself (whole limes, whole chickens).
  // These SUM and add on top of the form total — buying a chicken for its thighs
  // doesn't cover a chicken you wanted whole.
  readonly wholeCounts: readonly number[];
}

// The whole parent-product count to buy, aggregated across every contributor to
// one product-form-parent row (issue #501).
//
//   Σ(whole/direct) + MAX over forms of ( Σ that form's demand across recipes )
//
// The two rules, and why:
//   • SAME form, several recipes → SUM. Zest 10 g + 15 g = 25 g of zest, which is
//     5 limes. Two recipes each wanting zest genuinely need more limes.
//   • DIFFERENT forms of one parent → MAX. One egg yields its yolk AND its white
//     simultaneously, so 4 yolks + 3 whites is MAX(4,3) = 4 eggs, not 7.
//   • Whole/direct → SUM ON TOP, because a parent bought for its parts is
//     consumed as parts and can't also be the whole item.
//
// ROUNDING IS DEFERRED TO THE SUM, deliberately. Each demand carries an UNROUNDED
// parent-count, so a form's demand is summed raw and rounded ONCE at the end.
// Rounding per-recipe first is wrong: 6 g + 6 g of zest is 12 g = 3 limes, but
// rounding first gives 2 + 2 = 4. Matches `formParentCount`'s rule — a positive
// demand always needs at least one parent (you can't buy 0 limes for zest).
export function aggregateParentCount(input: ParentCountInput): number {
  const summedByForm = new Map<string, number>();
  for (const d of input.demands) {
    summedByForm.set(d.formId, (summedByForm.get(d.formId) ?? 0) + d.parentCount);
  }

  let formMax = 0;
  for (const sum of summedByForm.values()) {
    // Round once, on the summed raw demand — never per contributor.
    if (sum > 0) formMax = Math.max(formMax, Math.max(1, Math.round(sum)));
  }
  // Legacy contributors max into the same bucket: they represent the same
  // "max over forms" quantity, just already collapsed and rounded. A row with no
  // legacy contributor is unaffected; an all-legacy row gets exactly today's number.
  for (const c of input.legacyFormCounts) formMax = Math.max(formMax, c);

  let wholeSum = 0;
  for (const w of input.wholeCounts) wholeSum += w;

  return wholeSum + formMax;
}
