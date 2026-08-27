import type { IngredientGroupDoc } from '../schemas/index.js';
import { progressOver, type MiseProgress } from './progressOver.js';

// Mise-en-place progress, counted over the RECIPE rather than over the session's
// id list — see `progressOver` for why that direction matters and why an empty
// recipe is not `allChecked`. All this adds is the list: every ingredient in the
// recipe, across all groups.
export function miseProgress(
  ingredientGroups: readonly IngredientGroupDoc[],
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  return progressOver(
    ingredientGroups.flatMap((group) => group.items.map((item) => item.id)),
    checkedIds,
  );
}
