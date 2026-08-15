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
 * ONE RULE, APPLIED PER ROW: `startAtMs = serveAtMs - cookTimeMinutes`. Every
 * dish finishes AT serve time — that is the whole model, and it is what makes the
 * plan readable at a glance: a 1 h 30 m bird against a 19:00 serve starts at
 * 17:30, the 50 m potatoes at 18:10, the 10 m gravy at 18:50.
 *
 * COOK time, never `totalTimeMinutes`. Prep is done ahead and in any order, so it
 * says nothing about when a dish has to begin — the same reasoning that puts
 * `cookTimeMinutes` behind `insertComponentByCookTime`, and the two must agree or
 * the running order and the clock times would tell different stories.
 *
 * NULL IS AN ANSWER, NOT AN ERROR. No serve time yet, or a dish that declares no
 * cook time, yields `startAtMs: null` — "start this when you like". The row is
 * still returned: dropping it would hide a dish from the plan for the crime of
 * having an incomplete recipe, and the meal still has to be cooked.
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
    const minutes = recipe.metadata.cookTimeMinutes ?? null;
    return {
      recipeId: recipe.id,
      startAtMs: serveAtMs === null || minutes === null ? null : serveAtMs - minutes * 60_000,
    };
  });
}
