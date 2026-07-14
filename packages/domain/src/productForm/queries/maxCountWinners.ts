// When several product-form ingredients in one recipe resolve to the SAME parent
// canon (one lime gives both juice and zest), the shopper buys the MAX of their
// parent-counts, not the sum. Returns, per parentCanonId, the index of the
// winning entry (the greatest count; ties keep the first) so the caller can
// collapse the losing rows.
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
