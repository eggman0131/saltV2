import { recipePhaseTotals, type Recipe } from '../recipe/index.js';

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
 * ONE RULE, APPLIED PER ROW: `startAtMs = serveAtMs - elapsedMinutes`. Every dish
 * finishes AT serve time — that is the whole model, and it is what makes the plan
 * readable at a glance: a 1 h 30 m bird against a 19:00 serve starts at 17:30, the
 * 50 m potatoes at 18:10, the 10 m gravy at 18:50.
 *
 * THE WHOLE PROCESS, START TO SERVE — `recipePhaseTotals(...).elapsedMinutes`,
 * every phase of the strip summed, hands-on and hands-off alike. Until issue #1233
 * this worked back from a stored cook time alone, which quietly assumed
 * the chopping and weighing had already happened at some earlier point in the day;
 * with a phase strip there is nothing left to assume, so the app stops guessing and
 * start times move earlier (#953). `insertComponentByElapsedTime` orders the "Made
 * from" rows on the same figure, and the two must agree or the running order and
 * the clock times would tell different stories.
 *
 * NULL IS AN ANSWER, NOT AN ERROR. No serve time yet, or a dish with no phase
 * strip, yields `startAtMs: null` — "start this when you like". The row is still
 * returned: dropping it would hide a dish from the plan for the crime of having an
 * incomplete recipe, and the meal still has to be cooked.
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
    // `hasPhases`, never `elapsedMinutes >= 1`: a strip a cook has zeroed by hand
    // is a stated timing of nothing — "start it at serve time" — which is not the
    // same answer as an unknown.
    const totals = recipePhaseTotals(recipe.metadata.phases);
    return {
      recipeId: recipe.id,
      startAtMs:
        serveAtMs === null || !totals.hasPhases ? null : serveAtMs - totals.elapsedMinutes * 60_000,
    };
  });
}
