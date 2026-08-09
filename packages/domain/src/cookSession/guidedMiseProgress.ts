import type { GuidedPrepBoard, GuidedPrepCard } from './guidedPrepBoard.js';
import type { MiseProgress } from './miseProgress.js';

// Mise-en-place progress for a GUIDED cook (issue #751, Phase 2; recounted over
// the board in #767). Same contract as `miseProgress` and the same `MiseProgress`
// shape, over what a guided prep screen actually lists — which since #767 is not
// jobs but the INGREDIENTS inside them, plus the job-level row a job that names no
// ingredient keeps for itself, plus the "Also get out" remainder.
//
// Counted over THE ROWS ON SCREEN, never over the session's `checkedPrepIds`, for
// the same reason `miseProgress` counts over the recipe: a session can carry ticks
// for a prep entry the plan has since dropped, or for an ingredient the recipe has
// since lost, and neither may inflate the count or make an unfinished prep list
// read as done. The board is exactly those rows, so counting it is that rule.
//
// `allChecked` is false when there is nothing to do at all — "0 of 0 ready" is not
// an accomplishment, exactly as in `miseProgress`.
export function guidedMiseProgress(
  board: GuidedPrepBoard,
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  let total = 0;
  let checked = 0;
  for (const card of board.cards) {
    for (const id of card.tickIds) {
      total += 1;
      if (checkedIds.has(id)) checked += 1;
    }
  }
  for (const ingredient of board.alsoGetOut) {
    total += 1;
    if (checkedIds.has(ingredient.id)) checked += 1;
  }
  return { total, checked, allChecked: total > 0 && checked === total };
}

// The same count for ONE card (issue #767) — the "1/4" on its header, and the
// `allChecked` that collapses it to a done line once the bowl is filled.
//
// Its own function rather than a filter at the call site so the card header and
// the screen header cannot come to disagree about what a tick row is. A card
// always carries at least one row, so `allChecked` needs no empty-list guard of
// the kind `guidedMiseProgress` does — but it keeps one anyway, because the day a
// card can be empty is not the day anyone will remember this.
export function guidedPrepCardProgress(
  card: GuidedPrepCard,
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  let checked = 0;
  for (const id of card.tickIds) {
    if (checkedIds.has(id)) checked += 1;
  }
  const total = card.tickIds.length;
  return { total, checked, allChecked: total > 0 && checked === total };
}
