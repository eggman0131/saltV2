export function hasLiveCanonMatch(
  ref: { matchState: string; canonId: string | null },
  canonIds: ReadonlySet<string>,
): boolean {
  return (
    (ref.matchState === 'matched' || ref.matchState === 'needs_approval') &&
    ref.canonId !== null &&
    canonIds.has(ref.canonId)
  );
}
