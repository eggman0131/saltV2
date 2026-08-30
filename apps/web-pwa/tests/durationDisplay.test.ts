import { describe, it, expect } from 'vitest';
import { formatMinutes } from '../src/lib/durationDisplay.js';

/**
 * Characterisation net for `lib/durationDisplay.ts`'s `formatMinutes` (issue #933,
 * Phase 1). This module had NO test file at all, which is how it came to disagree
 * with `routes/recipes/recipeDuration.ts` about what "90 minutes" is called
 * without anything in CI noticing.
 *
 * WHAT THIS FILE IS FOR. It pins what this copy renders TODAY — including three
 * defects — so that Phase 3, which retires this body in favour of
 * `recipeDuration.ts`'s, shows the change as a diff to a test rather than as a
 * silent change to a screen. Every row below carries the CURRENT answer, and the
 * rows marked `EXCEPTION 1` are the ones Phase 3 is permitted to flip. A fourth
 * flipped row means Phase 3 did something it was not asked to.
 *
 * The input table mirrors `tests/recipeDuration.test.ts`'s so the two copies can
 * be read side by side; that file stays the surviving suite and is not edited here.
 */

// ── The spelling — this copy says `h`, `recipeDuration.ts` says `hr` ──────────
//
// EXCEPTION 1 applies to every row that renders an hour: Phase 3 makes them all
// read `hr`. The minutes-only rows below are unaffected and must not move.
describe('formatMinutes — the current `h` vocabulary', () => {
  const cases = [
    { name: 'a single minute', minutes: 1, rendered: '1 min' },
    { name: 'the middle of the sub-hour range', minutes: 40, rendered: '40 min' },
    { name: 'the last minute before the hour', minutes: 59, rendered: '59 min' },
    { name: 'the hour itself', minutes: 60, rendered: '1 h' },
    { name: 'one minute past the hour', minutes: 61, rendered: '1 h 1 min' },
    { name: 'an hour and a quarter', minutes: 75, rendered: '1 h 15 min' },
    {
      name: 'the 90-minute bake the two copies disagree about',
      minutes: 90,
      rendered: '1 h 30 min',
    },
    { name: 'a whole number of hours drops the minutes', minutes: 120, rendered: '2 h' },
    { name: 'two hours and a quarter', minutes: 135, rendered: '2 h 15 min' },
    { name: 'a six-hour prove', minutes: 360, rendered: '6 h' },
    { name: 'a full day stays in hours', minutes: 1440, rendered: '24 h' },
    { name: 'past a day, still hours', minutes: 1500, rendered: '25 h' },
    { name: 'a 36-hour cure is not 1 day 12 h', minutes: 2160, rendered: '36 h' },
  ];

  it.each(cases)('$name — $minutes → $rendered', ({ minutes, rendered }) => {
    expect(formatMinutes(minutes)).toBe(rendered);
  });
});

// ── The three defects this copy carries, and `recipeDuration.ts` does not ─────
//
// All three follow from ONE ordering choice: this copy takes `Math.floor(m / 60)`
// and `Math.round(m % 60)` on the raw input, where `recipeDuration.ts` rounds to a
// whole minute FIRST and then guards. Pinned here because Phase 3 deletes them,
// and a deletion nobody wrote down is indistinguishable from a regression.
describe('formatMinutes — the defects Phase 3 removes (EXCEPTION 1)', () => {
  it('renders a sixtieth minute rather than switching units — 59.6 is "60 min", not "1 h"', () => {
    // `Math.floor(59.6 / 60)` is 0, so the hour branch is never reached, and the
    // remainder rounds up to a full 60. `recipeDuration.ts` renders `1 hr`.
    expect(formatMinutes(59.6)).toBe('60 min');
  });

  it('renders arithmetic on a non-finite input instead of clamping it', () => {
    // NOTE: the issue's own summary table says `NaN min`. It is wrong — the hour
    // branch is taken because `NaN === 0` is false, so BOTH halves render. Pinned
    // as it actually is. `recipeDuration.ts` renders `0 min` for all three.
    expect(formatMinutes(Number.NaN)).toBe('NaN h NaN min');
    expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe('Infinity h NaN min');
    expect(formatMinutes(Number.NEGATIVE_INFINITY)).toBe('-Infinity h NaN min');
  });

  it('renders a negative duration as negative hours and negative minutes', () => {
    // `Math.floor(-5 / 60)` is -1, so a five-minute-negative value reads as an
    // hour and a bit — in the wrong direction. `recipeDuration.ts` renders `0 min`.
    expect(formatMinutes(-5)).toBe('-1 h -5 min');
    expect(formatMinutes(-0.5)).toBe('-1 h');
  });
});

// ── What the two copies already agree on, and must go on agreeing ─────────────
describe('formatMinutes — behaviour Phase 3 must preserve', () => {
  it('renders zero as zero minutes, on both copies', () => {
    expect(formatMinutes(0)).toBe('0 min');
  });

  it('rounds a fraction below the hour to the nearest minute', () => {
    expect(formatMinutes(40.4)).toBe('40 min');
  });

  it('rounds the leftover minutes of an over-the-hour fraction', () => {
    expect(formatMinutes(90.5)).toBe('1 h 31 min');
  });
});
