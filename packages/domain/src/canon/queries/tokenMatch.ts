// Stage 2 — token overlap ratio between two already-normalised strings.
// Returns a score in [0, 1]: overlap size / max set size.
// Penalises extra tokens in either direction equally.
export function tokenMatch(normA: string, normB: string): number {
  const setA = new Set(normA.split(' ').filter(Boolean));
  const setB = new Set(normB.split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}
