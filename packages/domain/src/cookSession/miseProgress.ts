import type { IngredientGroupDoc } from '../schemas/index.js';

export interface MiseProgress {
  /** Every ingredient in the recipe, across all groups. */
  readonly total: number;
  /** How many of those the cook has ticked. */
  readonly checked: number;
  /** True only when there is at least one ingredient AND every one is ticked. */
  readonly allChecked: boolean;
}

// Mise-en-place progress, counted over the RECIPE rather than over the session's
// id list. That direction matters: a session can carry checked ids for
// ingredients since edited out of the recipe, and those must not inflate the
// count or make an incomplete list read as fully ticked.
//
// `allChecked` is false for a recipe with no ingredients — "0 of 0 ready" is not
// an accomplishment, and the bulk-tick control it drives has nothing to tick.
export function miseProgress(
  ingredientGroups: readonly IngredientGroupDoc[],
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  let total = 0;
  let checked = 0;
  for (const group of ingredientGroups) {
    for (const item of group.items) {
      total += 1;
      if (checkedIds.has(item.id)) checked += 1;
    }
  }
  return { total, checked, allChecked: total > 0 && checked === total };
}
