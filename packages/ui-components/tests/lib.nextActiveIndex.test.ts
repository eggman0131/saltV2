// spec: ui-spec-v03.md §3.6 v0.3.5; ui-spec-v04.md §4.2 v0.4
//
// The listbox index arithmetic Select and Combobox now share (#929 Phase 5).
//
// Both suites drive Arrow/Home/End through their own keyboard handlers, so the
// integrated behaviour is covered twice over. What those suites cannot say is
// that the two agree on the *edges* — clamping rather than wrapping, and where a
// first move from nothing lands — because each only ever exercised its own copy.
// That agreement is the whole claim of extracting this function, so it is
// asserted here directly.
import { describe, it, expect } from 'vitest';
import { nextActiveIndex } from '../src/lib/nextActiveIndex';

describe('nextActiveIndex', () => {
  it.each([
    { name: 'empty list, down', current: null, total: 0, delta: 1 as const, expected: null },
    { name: 'empty list, first', current: null, total: 0, delta: 'first' as const, expected: null },
    { name: 'empty list, last', current: null, total: 0, delta: 'last' as const, expected: null },
  ])('$name → null', ({ current, total, delta, expected }) => {
    expect(nextActiveIndex(current, total, delta)).toBe(expected);
  });

  it.each([
    { name: 'Home from nothing', current: null, delta: 'first' as const, expected: 0 },
    { name: 'Home from the middle', current: 2, delta: 'first' as const, expected: 0 },
    { name: 'End from nothing', current: null, delta: 'last' as const, expected: 4 },
    { name: 'End from the middle', current: 2, delta: 'last' as const, expected: 4 },
  ])('$name', ({ current, delta, expected }) => {
    expect(nextActiveIndex(current, 5, delta)).toBe(expected);
  });

  describe('a first move from nothing lands on the near end', () => {
    it('Down goes to the top', () => {
      expect(nextActiveIndex(null, 5, 1)).toBe(0);
    });

    it('Up goes to the bottom', () => {
      expect(nextActiveIndex(null, 5, -1)).toBe(4);
    });
  });

  describe('movement clamps at the ends and never wraps', () => {
    // Both callers have always clamped. It matters most for Combobox, whose
    // create row is the last index: wrapping would step off it onto the first
    // real item, which is not what the down arrow at the bottom should do.
    it('Down at the last index stays there', () => {
      expect(nextActiveIndex(4, 5, 1)).toBe(4);
    });

    it('Up at the first index stays there', () => {
      expect(nextActiveIndex(0, 5, -1)).toBe(0);
    });

    it('moves one step in between', () => {
      expect(nextActiveIndex(2, 5, 1)).toBe(3);
      expect(nextActiveIndex(2, 5, -1)).toBe(1);
    });

    it('clamps an index left stale by a shrinking list', () => {
      // Combobox's total changes as the filter narrows, and the stored
      // activeIndex is not reset on every keystroke.
      expect(nextActiveIndex(9, 3, 1)).toBe(2);
      expect(nextActiveIndex(9, 3, -1)).toBe(2);
    });
  });

  it('handles a single-item list', () => {
    expect(nextActiveIndex(null, 1, 1)).toBe(0);
    expect(nextActiveIndex(null, 1, -1)).toBe(0);
    expect(nextActiveIndex(0, 1, 1)).toBe(0);
    expect(nextActiveIndex(0, 1, -1)).toBe(0);
    expect(nextActiveIndex(0, 1, 'last')).toBe(0);
  });
});
