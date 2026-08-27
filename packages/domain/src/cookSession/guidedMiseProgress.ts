import type { GuidedPrepBoard, GuidedPrepCard } from './guidedPrepBoard.js';
import { progressOver, type MiseProgress } from './progressOver.js';

// Mise-en-place progress for a GUIDED cook (issue #751, Phase 2; recounted over
// the board in #767), over what a guided prep screen actually lists — which since
// #767 is not jobs but the INGREDIENTS inside them, plus the job-level row a job
// that names no ingredient keeps for itself, plus the "Also get out" remainder.
// The board is exactly the rows on screen, so its ids are the list `progressOver`
// counts.
export function guidedMiseProgress(
  board: GuidedPrepBoard,
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  return progressOver(
    [
      ...board.cards.flatMap((card) => card.tickIds),
      ...board.alsoGetOut.map((ingredient) => ingredient.id),
    ],
    checkedIds,
  );
}

// The same count for ONE card (issue #767) — the "1/4" on its header, and the
// `allChecked` that collapses it to a done line once the bowl is filled.
//
// Its own function rather than a filter at the call site so the card header and
// the screen header cannot come to disagree about what a tick row is.
export function guidedPrepCardProgress(
  card: GuidedPrepCard,
  checkedIds: ReadonlySet<string>,
): MiseProgress {
  return progressOver(card.tickIds, checkedIds);
}
