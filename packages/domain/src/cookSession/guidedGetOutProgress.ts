import type { ContainerGetOutRow } from './containerGetOutList.js';
import type { MiseProgress } from './miseProgress.js';

// Get-out progress (issue #761, Phase 3) — the third member of the family, sharing
// the `MiseProgress` shape with `miseProgress` and `guidedMiseProgress` so the
// header line reads the same way at every stage.
//
// Counted over THE ROWS ON SCREEN, never over the session's
// `checkedContainerNames`, exactly as its two neighbours count over the recipe and
// over the prep list. A session can carry a tick for a bowl the plan has since
// renamed or dropped, and that must not inflate the count or make an unfinished
// bench read as gathered.
//
// `allChecked` is false when there is nothing to fetch at all — "0 of 0 out" is not
// an accomplishment, and a plan naming no containers has no Get-out stage anyway.
export function guidedGetOutProgress(
  rows: readonly ContainerGetOutRow[],
  checkedNames: ReadonlySet<string>,
): MiseProgress {
  let checked = 0;
  for (const row of rows) {
    if (checkedNames.has(row.key)) checked += 1;
  }
  return { total: rows.length, checked, allChecked: rows.length > 0 && checked === rows.length };
}
