// Word-level diff between two pieces of recipe prose (issue #825). PURE: a
// deterministic LCS over word-and-whitespace tokens — no clock, no I/O, no
// globals, no dependency. It sits beside `diffRecipe` because it answers the
// same kind of question one level down: `diffRecipe` says WHICH fields changed,
// this says WHAT MOVED inside one of them, so the review gate can show a
// reworded step as the handful of words that actually differ instead of two
// full paragraphs joined by an arrow.
//
// What this deliberately does NOT decide: how the result should be drawn. The
// thresholds that pick between "one line", "highlight the words in place" and
// "this was rewritten, show old above new" are presentation policy and live in
// the app. This module returns the parts and the ratio; the caller decides.
//
// Tokenising on `\s+|\S+` (rather than splitting on whitespace and rejoining)
// makes whitespace an ordinary token, so runs of spaces and newlines survive a
// round trip unchanged — a step's paragraph breaks are content, not formatting
// this layer is free to normalise.

/** One run of the diff. Concatenating `same`+`del` rebuilds `from`; `same`+`ins` rebuilds `to`. */
export type DiffPart = { kind: 'same' | 'del' | 'ins'; text: string };

// The LCS table is |from| × |to| cells. Recipe prose is short — a 500-character
// step is ~100 tokens, so ~10k cells — but the input is model-authored and
// nothing upstream bounds it. Past this many cells the pairing has stopped being
// readable anyway (a diff of two unrelated essays is noise), so degrade to a
// plain replacement rather than allocate an unbounded table.
const MAX_LCS_CELLS = 40_000;

function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Word-level diff from `from` to `to`, as an ordered list of runs. Adjacent runs
 * of the same kind are merged, so the result is the shortest rendering of the
 * edit rather than one part per token.
 */
export function diffWords(from: string, to: string): DiffPart[] {
  if (from === to) return from === '' ? [] : [{ kind: 'same', text: from }];
  if (from === '') return [{ kind: 'ins', text: to }];
  if (to === '') return [{ kind: 'del', text: from }];

  const a = tokenize(from);
  const b = tokenize(to);
  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      { kind: 'del', text: from },
      { kind: 'ins', text: to },
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..],
  // filled backwards so the walk below can read it forwards. Flat Int32Array:
  // one allocation, and the row stride is the only index arithmetic.
  const stride = b.length + 1;
  const lcs = new Int32Array((a.length + 1) * stride);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * stride + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * stride + (j + 1)]! + 1
          : Math.max(lcs[(i + 1) * stride + j]!, lcs[i * stride + (j + 1)]!);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string): void => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (lcs[(i + 1) * stride + j]! >= lcs[i * stride + (j + 1)]!) {
      // Ties go to the deletion, so a replacement always reads old-then-new.
      push('del', a[i]!);
      i++;
    } else {
      push('ins', b[j]!);
      j++;
    }
  }
  while (i < a.length) push('del', a[i++]!);
  while (j < b.length) push('ins', b[j++]!);
  return parts;
}

/**
 * How much of the longer side survived the edit, in [0, 1]. 1 = identical,
 * 0 = nothing in common. Measured against the LONGER of the two sides so that
 * neither growing nor shrinking a passage flatters the score: appending a
 * paragraph to a sentence is not "mostly unchanged".
 *
 * Whitespace is excluded from the count. The gaps between words nearly always
 * survive an edit — two entirely unrelated sentences still share their spaces —
 * so counting them would report a wholesale rewrite as several percent
 * unchanged and, on a long paragraph, drift the score toward the middle where
 * the caller's threshold lives. The question this answers is how much of the
 * CONTENT survived, and a space is not content.
 *
 * Two empty sides score 1 — there is no edit to report.
 */
export function unchangedRatio(parts: readonly DiffPart[]): number {
  const weigh = (text: string): number => text.replace(/\s+/g, '').length;
  let same = 0;
  let del = 0;
  let ins = 0;
  for (const part of parts) {
    if (part.kind === 'same') same += weigh(part.text);
    else if (part.kind === 'del') del += weigh(part.text);
    else ins += weigh(part.text);
  }
  const longest = Math.max(same + del, same + ins);
  return longest === 0 ? 1 : same / longest;
}
