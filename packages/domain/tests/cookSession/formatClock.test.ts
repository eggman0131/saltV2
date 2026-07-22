import { describe, it, expect } from 'vitest';
import { formatClock } from '@salt/domain';

// mm:ss for a millisecond span (issue #556). Clamped at 0:00, CEILed so a fresh
// timer reads the number the button promised, and NOT rolled over into hours.

describe('formatClock', () => {
  const cases: Array<[number, string]> = [
    // ─── Clamping: an overrun timer reads 0:00, never a negative ──────────────
    [0, '0:00'],
    [-1, '0:00'],
    [-999, '0:00'],
    [-60_000, '0:00'],
    // ─── Ceil: any fraction of a second left still shows that second ──────────
    [1, '0:01'],
    [999, '0:01'],
    [1000, '0:01'],
    [1001, '0:02'],
    // A 5:00 timer must read "5:00" on its first frame, not flick to 4:59.
    [299_999, '5:00'],
    [300_000, '5:00'],
    [300_001, '5:01'],
    // ─── Zero padding on seconds, never on minutes ────────────────────────────
    [9000, '0:09'],
    [59_000, '0:59'],
    [59_001, '1:00'],
    [60_000, '1:00'],
    [61_000, '1:01'],
    [69_000, '1:09'],
    [600_000, '10:00'],
    // ─── No hour rollover: a long braise counts in minutes ────────────────────
    [3_600_000, '60:00'],
    [5_400_000, '90:00'],
    [7_262_000, '121:02'],
  ];

  it.each(cases)('formats %ims as %s', (ms, expected) => {
    expect(formatClock(ms)).toBe(expected);
  });

  it('always emits two digits of seconds', () => {
    for (let seconds = 0; seconds < 60; seconds += 1) {
      expect(formatClock(seconds * 1000)).toMatch(/^\d+:\d{2}$/);
    }
  });
});
