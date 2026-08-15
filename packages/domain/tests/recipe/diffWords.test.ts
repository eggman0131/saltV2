import { describe, it, expect } from 'vitest';
import { diffWords, unchangedRatio } from '@salt/domain';
import type { DiffPart } from '@salt/domain';

// The two properties every case below is really checking: the `same`+`del` parts
// rebuild the left side exactly, and the `same`+`ins` parts rebuild the right
// side exactly. If either fails, the review gate is showing the user prose that
// is not in either version of the recipe — the one thing an approval gate must
// never do.
function rebuild(parts: readonly DiffPart[], side: 'from' | 'to'): string {
  const drop = side === 'from' ? 'ins' : 'del';
  return parts
    .filter((p) => p.kind !== drop)
    .map((p) => p.text)
    .join('');
}

function expectRoundTrip(from: string, to: string): DiffPart[] {
  const parts = diffWords(from, to);
  expect(rebuild(parts, 'from')).toBe(from);
  expect(rebuild(parts, 'to')).toBe(to);
  return parts;
}

describe('diffWords', () => {
  it('reports an identical string as one unchanged run', () => {
    const parts = expectRoundTrip('Scrub the potatoes', 'Scrub the potatoes');
    expect(parts).toEqual([{ kind: 'same', text: 'Scrub the potatoes' }]);
    expect(unchangedRatio(parts)).toBe(1);
  });

  it('reports two empty strings as no edit at all', () => {
    expect(diffWords('', '')).toEqual([]);
    // No parts must not divide by zero — an absent edit is fully unchanged.
    expect(unchangedRatio([])).toBe(1);
  });

  it('marks a pure insertion and leaves the surrounding words alone', () => {
    const parts = expectRoundTrip('Roast the chicken', 'Roast the whole chicken');
    expect(parts.filter((p) => p.kind === 'del')).toEqual([]);
    expect(parts.filter((p) => p.kind === 'ins').map((p) => p.text.trim())).toEqual(['whole']);
  });

  it('marks a pure deletion and leaves the surrounding words alone', () => {
    const parts = expectRoundTrip('Roast the whole chicken', 'Roast the chicken');
    expect(parts.filter((p) => p.kind === 'ins')).toEqual([]);
    expect(parts.filter((p) => p.kind === 'del').map((p) => p.text.trim())).toEqual(['whole']);
  });

  it('scores a wholesale replacement as nothing in common', () => {
    // Two unrelated sentences still share the space between their words, so the
    // LCS legitimately anchors on it. That must not read as "6% unchanged":
    // whitespace is excluded from the ratio precisely so this lands on 0 and the
    // caller renders it as a rewrite rather than a word-level highlight.
    const parts = expectRoundTrip('Season generously', 'Chill overnight');
    expect(parts.some((p) => p.kind === 'same' && p.text.trim() !== '')).toBe(false);
    expect(unchangedRatio(parts)).toBe(0);
  });

  it('handles an empty side without inventing a pairing', () => {
    expect(diffWords('', 'Chill overnight')).toEqual([{ kind: 'ins', text: 'Chill overnight' }]);
    expect(diffWords('Chill overnight', '')).toEqual([{ kind: 'del', text: 'Chill overnight' }]);
  });

  it('preserves whitespace verbatim, including paragraph breaks', () => {
    // A step's line breaks are content. Splitting on whitespace and rejoining
    // with single spaces would silently reflow the recipe in the review gate.
    const from = 'Mix  the   dough.\n\nRest it cold.';
    const to = 'Mix  the   dough.\n\nRest it warm.';
    const parts = expectRoundTrip(from, to);
    expect(parts.some((p) => p.kind === 'same' && p.text.includes('\n\n'))).toBe(true);
  });

  it('puts the deletion before the insertion when a word is swapped', () => {
    // Ties in the LCS walk go to the deletion, so a replacement always reads
    // old-then-new rather than flipping with the input.
    const parts = expectRoundTrip('Rest it cold', 'Rest it warm');
    const marks = parts.filter((p) => p.kind !== 'same').map((p) => p.kind);
    expect(marks).toEqual(['del', 'ins']);
  });

  it('degrades a pair too large to pair sensibly into a plain replacement', () => {
    // Past MAX_LCS_CELLS (40k) the table stops being allocated. 250 words each
    // is 62,500 cells — over the guard — and a word-by-word pairing of two
    // essays would be unreadable noise even if it were cheap.
    const from = Array.from({ length: 250 }, (_, i) => `alpha${i}`).join(' ');
    const to = Array.from({ length: 250 }, (_, i) => `beta${i}`).join(' ');
    const parts = expectRoundTrip(from, to);
    expect(parts).toEqual([
      { kind: 'del', text: from },
      { kind: 'ins', text: to },
    ]);
  });

  it('stays under the guard for prose the length of a real step', () => {
    // The guard must not fire on the content it exists to serve: the worst row
    // measured on real staging data was 493 characters, ~90 tokens a side.
    const from = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
    const to = from.replace('word45', 'replaced');
    const parts = expectRoundTrip(from, to);
    expect(parts.filter((p) => p.kind === 'same').length).toBeGreaterThan(1);
  });
});

describe('unchangedRatio', () => {
  it('scores an adjusted sentence high and a rewritten one low', () => {
    // The two ends the app's rendering threshold sits between: the first pair is
    // "the same sentence, adjusted", the second is a different sentence.
    const adjusted = unchangedRatio(
      diffWords('Rest the dough in the fridge overnight', 'Rest the dough in the fridge for a day'),
    );
    const rewritten = unchangedRatio(
      diffWords(
        'Rest the dough in the fridge overnight',
        'Shape into a tight ball and leave somewhere warm',
      ),
    );
    expect(adjusted).toBeGreaterThan(0.4);
    expect(rewritten).toBeLessThan(0.4);
  });

  it('measures against the longer side, so appending does not read as unchanged', () => {
    // Half the new text is brand new; scoring against the ORIGINAL length would
    // call this 1.0 and hide a doubled paragraph behind a word highlight.
    const parts = diffWords('Chop the onions', 'Chop the onions and sweat them slowly');
    expect(unchangedRatio(parts)).toBeLessThan(0.5);
  });

  it('is symmetric in magnitude for a swap of the same size', () => {
    const forward = unchangedRatio(diffWords('Rest it cold', 'Rest it warm'));
    const back = unchangedRatio(diffWords('Rest it warm', 'Rest it cold'));
    expect(forward).toBe(back);
  });
});
