export interface MiseProgress {
  /** How many rows there are to tick. */
  readonly total: number;
  /** How many of those the cook has ticked. */
  readonly checked: number;
  /** True only when there is at least one row AND every one is ticked. */
  readonly allChecked: boolean;
}

// The one count behind every "n of m ready" in a cook (issue #994, Phase 3).
//
// Every caller asks the same two questions of a different list, so the only
// thing that ever differed was the list — `miseProgress` over the recipe's
// ingredients, `guidedMiseProgress` over the guided prep board, and
// `guidedPrepCardProgress` over one card's rows. They were three copies of this
// loop with a byte-identical `allChecked`; they are now three iterables.
//
// Counted over THE IDS PASSED IN, never over the session's checked-id list. That
// direction is the whole point: a session can carry ticks for an ingredient the
// recipe has since lost or a prep entry the plan has since dropped, and neither
// may inflate the count or make an unfinished list read as done. Each adapter
// supplies the rows that are actually on screen, so counting them is that rule.
//
// `allChecked` is false when there is nothing to tick at all — "0 of 0 ready" is
// not an accomplishment, and a bulk-tick control it drives has nothing to tick.
export function progressOver(ids: Iterable<string>, checkedIds: ReadonlySet<string>): MiseProgress {
  let total = 0;
  let checked = 0;
  for (const id of ids) {
    total += 1;
    if (checkedIds.has(id)) checked += 1;
  }
  return { total, checked, allChecked: total > 0 && checked === total };
}
