import type { GuidedPrepEntryDoc, IngredientDoc } from '../schemas/index.js';
import type { MiseProgress } from './miseProgress.js';

// Mise-en-place progress for a GUIDED cook (issue #751, Phase 2). Same contract as
// `miseProgress` and the same `MiseProgress` shape, over what a guided prep screen
// actually lists: the plan's prep jobs, plus any ingredient the plan names in no
// job (`unpreppedIngredients` — the "Also get out" remainder).
//
// Counted over those two lists rather than over the session's `checkedPrepIds`,
// for the same reason `miseProgress` counts over the recipe: a session can carry
// ticks for a prep entry the plan has since dropped, or for an ingredient the
// recipe has since lost, and neither may inflate the count or make an unfinished
// prep list read as done.
//
// `allChecked` is false when there is nothing to do at all — "0 of 0 ready" is not
// an accomplishment, exactly as in `miseProgress`.
export function guidedMiseProgress(
  prep: readonly GuidedPrepEntryDoc[],
  alsoGetOut: readonly IngredientDoc[],
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  let total = 0;
  let checked = 0;
  for (const entry of prep) {
    total += 1;
    if (checkedIds.has(entry.id)) checked += 1;
  }
  for (const ingredient of alsoGetOut) {
    total += 1;
    if (checkedIds.has(ingredient.id)) checked += 1;
  }
  return { total, checked, allChecked: total > 0 && checked === total };
}
