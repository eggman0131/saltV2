import { describe, it, expect } from 'vitest';
import { tokenMatch } from '../../src/canon/queries/tokenMatch.js';

describe('tokenMatch', () => {
  it('returns 1 for identical strings', () => {
    expect(tokenMatch('olive oil', 'olive oil')).toBe(1);
    expect(tokenMatch('tomato', 'tomato')).toBe(1);
  });

  it('returns 0 for completely different tokens', () => {
    expect(tokenMatch('butter', 'tomato')).toBe(0);
    expect(tokenMatch('carrot', 'olive oil')).toBe(0);
  });

  it('returns partial score for partial overlap', () => {
    // 'olive' matches, 'oil' does not match 'butter' → overlap=1 of max(2,1)=2
    expect(tokenMatch('olive oil', 'olive')).toBeCloseTo(0.5);
    // 'extra virgin olive oil' (4 tokens) vs 'olive oil' (2 tokens): 2 overlap, max=4
    expect(tokenMatch('extra virgin olive oil', 'olive oil')).toBeCloseTo(0.5);
  });

  it('is symmetric', () => {
    const a = tokenMatch('extra virgin olive oil', 'olive oil');
    const b = tokenMatch('olive oil', 'extra virgin olive oil');
    expect(a).toBeCloseTo(b);
  });

  it('returns 0 for empty strings', () => {
    expect(tokenMatch('', 'tomato')).toBe(0);
    expect(tokenMatch('tomato', '')).toBe(0);
    expect(tokenMatch('', '')).toBe(0);
  });

  it('reaches stop threshold for high-overlap matches', () => {
    // Both single tokens identical — should be 1.0 >= stage2Stop (0.80)
    expect(tokenMatch('tomato', 'tomato')).toBeGreaterThanOrEqual(0.8);
  });

  it('does not reach stop threshold for low-overlap matches', () => {
    expect(tokenMatch('butter', 'peanut butter')).toBeCloseTo(1 / 2); // 1 of max(1,2)=2
  });
});
