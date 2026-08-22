import { describe, it, expect } from 'vitest';
import { formatMinutes } from '../src/routes/recipes/recipeDuration.js';

describe('formatMinutes', () => {
  it('keeps the sub-hour range in minutes, because that is the unit a cook thinks in', () => {
    expect(formatMinutes(1)).toBe('1 min');
    expect(formatMinutes(40)).toBe('40 min');
    expect(formatMinutes(59)).toBe('59 min');
  });

  it('switches to hours at the hour, and only at the hour', () => {
    expect(formatMinutes(59)).toBe('59 min');
    expect(formatMinutes(60)).toBe('1 hr');
    expect(formatMinutes(61)).toBe('1 hr 1 min');
  });

  it('drops the minutes when there are none — 6 hr, not 6 hr 0 min', () => {
    expect(formatMinutes(120)).toBe('2 hr');
    expect(formatMinutes(360)).toBe('6 hr');
  });

  it('carries the leftover minutes when there are some', () => {
    expect(formatMinutes(75)).toBe('1 hr 15 min');
    expect(formatMinutes(90)).toBe('1 hr 30 min');
    expect(formatMinutes(91)).toBe('1 hr 31 min');
    expect(formatMinutes(135)).toBe('2 hr 15 min');
  });

  it('never displays a duration over 90 minutes in minutes (issue #878)', () => {
    for (let m = 91; m <= 3000; m += 1) {
      expect(formatMinutes(m)).toMatch(/^\d+ hr( \d+ min)?$/);
    }
  });

  it('stays in hours past a day — a long cure is 36 hr, not 1 day 12 hr', () => {
    expect(formatMinutes(1440)).toBe('24 hr');
    expect(formatMinutes(2160)).toBe('36 hr');
    expect(formatMinutes(1500)).toBe('25 hr');
  });

  it('rounds a fractional minute rather than rendering one', () => {
    expect(formatMinutes(40.4)).toBe('40 min');
    expect(formatMinutes(59.6)).toBe('1 hr');
    expect(formatMinutes(90.5)).toBe('1 hr 31 min');
  });

  it('renders a nonsense value rather than throwing on a page that only displays it', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(-5)).toBe('0 min');
    expect(formatMinutes(Number.NaN)).toBe('0 min');
  });
});
