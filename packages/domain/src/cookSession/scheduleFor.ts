import { recipePhaseTotals } from '../recipe/index.js';
import type { Recipe } from '../recipe/index.js';

/** One row of a meal's cook plan: a dish, and the clock instant it has to begin. */
export interface ScheduledRow {
  readonly recipeId: string;
  /** When to start, in epoch ms. Null = there is nothing to work back from. */
  readonly startAtMs: number | null;
}

/**
 * When each dish of a meal has to go on, worked back from one serve time (issue
 * #752).
 *
 * ONE RULE, APPLIED PER ROW: `startAtMs = serveAtMs - elapsedMinutes`, where
 * elapsed is the sum of the dish's phases. Every dish finishes AT serve time —
 * that is the whole model, and it is what makes the plan readable at a glance.
 *
 * THE WHOLE PROCESS, START TO SERVE — not the time on heat (issues #953, #1122).
 * This reverses what stood here while the app carried three stored time numbers:
 * the clock worked back from `cookTimeMinutes` alone, which quietly assumed the
 * chopping and weighing had happened at some earlier point in the day. It is a
 * guess the app no longer has to make, because a phase strip records the
 * unattended minutes separately: the start time is `serve − elapsed`, and the
 * strip beside it is what says how much of that is the cook. Start times are
 * therefore EARLIER than they were, and that is the honest number.
 *
 * `insertComponentByCookTime` orders the "Made from" rows on the same figure, and
 * the two must keep agreeing or the order you are told to start things in and the
 * times you are told to start them at would tell different stories. That is not
 * left to these two comments to guarantee:
 * `packages/domain/tests/cookSession/scheduleFor.test.ts` pins the agreement over
 * fixtures both functions are asked about.
 *
 * NULL IS AN ANSWER, NOT AN ERROR. No serve time yet, or a dish with no phases,
 * yields `startAtMs: null` — "start this when you like". The row is still
 * returned: dropping it would hide a dish from the plan for the crime of having
 * an incomplete recipe, and the meal still has to be cooked.
 *
 * IT DOES NOT SORT. Input order is preserved verbatim, because the caller's order
 * is `componentRecipeIds` — the order the user dragged the dishes into, which is
 * the running order. Re-sorting here would silently undo that.
 *
 * Per-row independent, so it knows nothing about ordering, about components, or
 * about what a meal is; it is arithmetic over a list of dishes. Pure — the clock
 * is injected as `serveAtMs`, nothing is mutated, nothing is read from the
 * outside.
 */
export function scheduleFor(rows: readonly Recipe[], serveAtMs: number | null): ScheduledRow[] {
  return rows.map((recipe) => {
    // `hasPhases`, not `elapsedMinutes > 0`: a strip a cook has zeroed by hand is
    // a stated timing of nothing, so that dish starts AT serve time, whereas a
    // recipe with no strip has nothing to work back from at all.
    const totals = recipePhaseTotals(recipe.metadata.phases);
    return {
      recipeId: recipe.id,
      startAtMs:
        serveAtMs === null || !totals.hasPhases ? null : serveAtMs - totals.elapsedMinutes * 60_000,
    };
  });
}
