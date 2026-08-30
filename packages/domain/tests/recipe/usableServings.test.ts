import { describe, it, expect } from 'vitest';
import { usableServings } from '../../src/index.js';

// Issue #1123. The rule every scaler needs and none of them stated: `?? 1` treats
// a MISSING servings count as "scale from 1", and a stored 0 is not missing — it
// is the value that makes the division meaningless.

describe('usableServings', () => {
  it('passes a real count through', () => {
    expect(usableServings(4)).toBe(4);
    expect(usableServings(1)).toBe(1);
  });

  it('reports an unstated count as unstated', () => {
    expect(usableServings(null)).toBeNull();
  });

  it('reports 0 as unstated — a base of zero is what divided a list by Infinity', () => {
    expect(usableServings(0)).toBeNull();
  });

  it('reports a negative count as unstated — it would flip every amount', () => {
    expect(usableServings(-2)).toBeNull();
  });

  it('reports a non-finite count as unstated', () => {
    expect(usableServings(Number.POSITIVE_INFINITY)).toBeNull();
    expect(usableServings(Number.NaN)).toBeNull();
  });

  it('leaves a fractional count usable — "serves 2.5" scales fine, it just reads oddly', () => {
    expect(usableServings(2.5)).toBe(2.5);
  });
});
