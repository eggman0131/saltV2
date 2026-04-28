import { describe, it, expect } from 'vitest';
import { stringSimilarity } from '../../src/canon/queries/stringSimilarity.js';

describe('stringSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(stringSimilarity('tomato', 'tomato')).toBe(1);
    expect(stringSimilarity('', '')).toBe(1);
  });

  it('returns 0 for completely different strings of equal length', () => {
    // 'butter' vs 'tomato': all chars differ → distance 6, max 6, score 0
    expect(stringSimilarity('butter', 'tomato')).toBeCloseTo(0);
  });

  it('handles a single-character typo', () => {
    // 'tomatoe' vs 'tomato': distance 1, max 7 → ~0.857
    const score = stringSimilarity('tomatoe', 'tomato');
    expect(score).toBeGreaterThan(0.85);
  });

  it('meets stage 4 stop threshold for near-identical strings', () => {
    // distance 1 in a 7-char string → score ~0.857 >= 0.85
    expect(stringSimilarity('tomatoe', 'tomato')).toBeGreaterThanOrEqual(0.85);
  });

  it('does not meet stage 4 threshold for a 2-char difference', () => {
    // 'tomatos' vs 'tomato': distance 1, score ~0.857... actually > 0.85
    // use a worse case: 'carott' vs 'carrot': distance 2, max 6, score ~0.667
    expect(stringSimilarity('carott', 'carrot')).toBeLessThan(0.85);
  });

  it('is symmetric', () => {
    expect(stringSimilarity('abc', 'xyz')).toBeCloseTo(stringSimilarity('xyz', 'abc'));
  });

  it('returns a score based on max length when strings differ in length', () => {
    // 'cat' vs 'cats': distance 1, max 4 → 0.75
    expect(stringSimilarity('cat', 'cats')).toBeCloseTo(0.75);
  });
});
