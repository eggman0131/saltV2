// Stage 4 — Levenshtein edit distance, normalised to [0, 1].
// score = 1 − (editDistance / maxLength).
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let curr: number[] = new Array(n + 1).fill(0) as number[];
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const prevJ = prev[j] as number;
      const currJ1 = curr[j - 1] as number;
      const prevJ1 = prev[j - 1] as number;
      curr[j] = a[i - 1] === b[j - 1] ? prevJ1 : 1 + Math.min(prevJ, currJ1, prevJ1);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] as number;
}
