import type { RecipePhase } from '../entities/Recipe.js';

// The one place that adds a recipe's phases up (issue #1122).
//
// PURE (CLAUDE.md rule 1): plain data in, plain data out. No markup, no
// percentages, no CSS — the timeline is one rendering of this, the list chip is
// another, and the meal cook plan's start clock is a third.
//
// WHY EVERY CONSUMER COMES THROUGH HERE. `totalTimeMinutes` was a stored number
// that could disagree with the parts beneath it, and that disagreement is the
// whole defect this issue closes. The replacement is a sum computed at the point
// of use, so "how long does this take" has exactly one answer and it is the same
// answer the strip draws. Nothing derived from these numbers is ever written back
// to Firestore — a stored derivative is the same defect wearing a different name.
//
// It also swallows the TWO ways a recipe can have no phases — the key absent (a
// document written before this shipped) and an empty array — into one flag, so
// no caller has to remember that `metadata.phases` is optional. A phase list
// that sums to zero is deliberately NOT a third one: see `hasPhases` below.

/** Elapsed time of one phase. Derived, never stored: two numbers cannot disagree. */
export function phaseElapsedMinutes(phase: Readonly<RecipePhase>): number {
  return safeMinutes(phase.handsOnMinutes) + safeMinutes(phase.handsOffMinutes);
}

export interface RecipePhaseTotals {
  /** Wall clock from starting to serving: every phase's elapsed time, summed. */
  readonly elapsedMinutes: number;
  /** Time at the counter — the number that decides whether tonight is possible. */
  readonly handsOnMinutes: number;
  /** Time the dish spends looking after itself. */
  readonly handsOffMinutes: number;
  /**
   * Whether this recipe has a timing at all.
   *
   * False for an absent or empty list. It is NOT `elapsedMinutes > 0`: a phase
   * list of three named blocks that a cook has zeroed by hand is still a stated
   * timing, and reading it as "unknown" would put the old chips back on screen
   * mid-migration. Callers that need "is there anything to draw" want this;
   * callers that need "is there a number to show" should test the minutes.
   */
  readonly hasPhases: boolean;
}

const NONE: RecipePhaseTotals = {
  elapsedMinutes: 0,
  handsOnMinutes: 0,
  handsOffMinutes: 0,
  hasPhases: false,
};

/**
 * Sum a recipe's phases.
 *
 * Takes the phase list rather than the whole `Recipe` so a half-built list in the
 * edit page's row editor can be summed with the same function that sums a stored
 * one — the alternative is a second implementation of the same addition, which is
 * the split-definition defect again at a smaller scale.
 *
 * Defensive on the numbers because `RecipePhaseSchema` types them as plain
 * `number` and this is downstream of a permissive READ boundary: a `NaN`, an
 * `Infinity` or a negative that reached a stored document counts as 0 rather than
 * poisoning the sum for the whole recipe. That is the same bargain `formatMinutes`
 * makes on the display side.
 */
export function recipePhaseTotals(
  phases: readonly Readonly<RecipePhase>[] | undefined,
): RecipePhaseTotals {
  if (phases === undefined || phases.length === 0) return NONE;
  let handsOnMinutes = 0;
  let handsOffMinutes = 0;
  for (const phase of phases) {
    handsOnMinutes += safeMinutes(phase.handsOnMinutes);
    handsOffMinutes += safeMinutes(phase.handsOffMinutes);
  }
  return {
    elapsedMinutes: handsOnMinutes + handsOffMinutes,
    handsOnMinutes,
    handsOffMinutes,
    hasPhases: true,
  };
}

function safeMinutes(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
