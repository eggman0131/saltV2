import type { GuidedPrepGroup } from './guidedPrepBoard.js';
import type { IngredientDoc } from '../schemas/index.js';
import type { MiseProgress } from './miseProgress.js';

// Mise-en-place progress for a GUIDED cook (issue #751, Phase 2). Same contract as
// `miseProgress` and the same `MiseProgress` shape, over what a guided prep screen
// actually lists: every tickable row on the bench (`guidedPrepBoard`), plus any
// ingredient the plan names in no job (`unpreppedIngredients` — the "Also get out"
// remainder).
//
// COUNTED IN TICK ROWS, not in jobs (issue #767). A job that dices three things is
// three rows, because that is three separate pieces of work the cook does one at a
// time — counting it as one made a long job and a trivial one weigh the same, and
// made the counter sit still through most of the actual chopping. A job that names
// no ingredients still contributes exactly one row, which is the whole of what
// changed for it.
//
// Counted over the ROWS rather than over the session's `checkedPrepIds`, for the
// same reason `miseProgress` counts over the recipe: a session can carry ticks for
// a prep entry the plan has since dropped, or for an ingredient the recipe has
// since lost, and neither may inflate the count or make an unfinished prep list
// read as done.
//
// `allChecked` is false when there is nothing to do at all — "0 of 0 ready" is not
// an accomplishment, exactly as in `miseProgress`.
export function guidedMiseProgress(
  groups: readonly GuidedPrepGroup[],
  alsoGetOut: readonly IngredientDoc[],
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  let total = 0;
  let checked = 0;
  for (const group of groups) {
    for (const id of group.tickIds) {
      total += 1;
      if (checkedIds.has(id)) checked += 1;
    }
  }
  for (const ingredient of alsoGetOut) {
    total += 1;
    if (checkedIds.has(ingredient.id)) checked += 1;
  }
  return { total, checked, allChecked: total > 0 && checked === total };
}
