import { describe, it, expect } from 'vitest';
import {
  GRAM_DECIMAL_THRESHOLD,
  PERCENT_DECIMALS,
  roundGrams,
  roundPercent,
} from '../../src/index.js';

describe('roundGrams', () => {
  it('gives whole grams at or above the threshold', () => {
    expect(GRAM_DECIMAL_THRESHOLD).toBe(10);
    // The worked example's salt and yeast: 16.8 g and 11.8 g are arithmetically
    // finer and physically unweighable on a 1 g domestic scale.
    expect(roundGrams(16.816326530612244)).toBe(17);
    expect(roundGrams(11.771428571428572)).toBe(12);
    expect(roundGrams(840.8163265306122)).toBe(841);
    expect(roundGrams(1483.2)).toBe(1483);
  });

  it('keeps one decimal below the threshold', () => {
    // A 2.5 g cure-salt figure still has its decimal when phase 04 needs it.
    expect(roundGrams(2.52)).toBe(2.5);
    expect(roundGrams(0.24)).toBe(0.2);
    expect(roundGrams(9.94)).toBe(9.9);
  });

  it('rounds up to the threshold from below it', () => {
    expect(roundGrams(9.96)).toBe(10);
  });

  it('never hands a NaN to a scale', () => {
    expect(roundGrams(Number.NaN)).toBe(0);
    expect(roundGrams(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('roundPercent', () => {
  it('clears IEEE 754 noise out of a derived percentage', () => {
    // 350 / 500 × 100.
    expect(roundPercent(70.00000000000001)).toBe(70);
    expect(roundPercent(1.4000000000000001)).toBe(1.4);
  });

  it('keeps four decimals — a hundredth of a gram on a domestic loaf', () => {
    expect(PERCENT_DECIMALS).toBe(4);
    expect(roundPercent(33.333333333333336)).toBe(33.3333);
  });
});
