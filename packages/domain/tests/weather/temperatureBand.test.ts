import { describe, it, expect } from 'vitest';
import { temperatureBand } from '@salt/domain';
import type { TemperatureBand } from '@salt/domain';

// Pure heat-band classification (issue #382, Phase 3). The band POLICY (enum +
// whole-degree cutoffs) lives in the domain so the view only maps band → colour
// class. These tests pin the cutoffs and the boundary behaviour (inclusive lower
// bound per band) so a colour shift can't silently drift.

describe('temperatureBand', () => {
  it('classifies representative temperatures across the full range', () => {
    const cases: Array<[number, TemperatureBand]> = [
      [-5, 'freezing'],
      [3, 'cold'],
      [10, 'cool'],
      [17, 'mild'],
      [24, 'warm'],
      [30, 'hot'],
    ];
    for (const [temp, band] of cases) {
      expect(temperatureBand(temp)).toBe(band);
    }
  });

  it('uses an inclusive lower bound at each band boundary', () => {
    // The exact cutoff belongs to the warmer band.
    expect(temperatureBand(0)).toBe('cold');
    expect(temperatureBand(8)).toBe('cool');
    expect(temperatureBand(15)).toBe('mild');
    expect(temperatureBand(20)).toBe('warm');
    expect(temperatureBand(26)).toBe('hot');
    // Just below a cutoff stays in the cooler band.
    expect(temperatureBand(-0.1)).toBe('freezing');
    expect(temperatureBand(7.9)).toBe('cold'); // below the 8°C 'cool' cutoff
    expect(temperatureBand(19.9)).toBe('mild'); // below the 20°C 'warm' cutoff
    expect(temperatureBand(25.9)).toBe('warm'); // below the 26°C 'hot' cutoff
  });

  it('treats sub-zero as freezing and very hot as hot', () => {
    expect(temperatureBand(-40)).toBe('freezing');
    expect(temperatureBand(45)).toBe('hot');
  });

  it('degrades a non-finite temperature to the coldest band rather than throwing', () => {
    expect(temperatureBand(Number.NaN)).toBe('freezing');
    expect(temperatureBand(Number.POSITIVE_INFINITY)).toBe('freezing');
    expect(temperatureBand(Number.NEGATIVE_INFINITY)).toBe('freezing');
  });
});
