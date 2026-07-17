// When several product-form ingredients in one recipe resolve to the SAME parent
// canon (one lime gives both juice and zest), they collapse to a single row for
// that parent. Returns, per parentCanonId, the index of the entry that should
// REPRESENT the row (the greatest count; ties keep the first) so the caller can
// drop the losers.
//
// This picks a row, NOT a count. The parent count to buy is `aggregateParentCount`
// — same form SUMS, distinct forms MAX (issues #518/#521) — so the greatest single
// count is not generally the answer, and callers must not use it as one. The
// losers' demand must ride onto the surviving row (see `buildRecipeAddPlan`);
// dropping it here would make the correct count unrecoverable downstream.
export function maxCountWinners(
  entries: readonly { parentCanonId: string; count: number }[],
): ReadonlyMap<string, number> {
  const winners = new Map<string, number>();
  entries.forEach((e, i) => {
    const cur = winners.get(e.parentCanonId);
    if (cur === undefined || e.count > entries[cur]!.count) winners.set(e.parentCanonId, i);
  });
  return winners;
}
