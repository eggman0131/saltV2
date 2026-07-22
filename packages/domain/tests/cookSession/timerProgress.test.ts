import { describe, it, expect } from 'vitest';
import { timerProgress } from '@salt/domain';
import type { CookActiveTimerDoc } from '@salt/domain/schemas';

// Fraction (0..1) of a timer's run that has ELAPSED, for the progress fill
// (issue #556). Derived from the step's own duration plus the absolute `endsAt`,
// with `nowMs` INJECTED — no clock read, so no fake timers needed here.

const ENDS_AT = '2026-07-22T18:35:00.000Z';
const END_MS = Date.parse(ENDS_AT);
const FIVE_MIN = 5 * 60_000;

const TIMER: CookActiveTimerDoc = { stepId: 's1', endsAt: ENDS_AT, notify: false };

describe('timerProgress', () => {
  // [label, nowMs, expected fraction]
  const cases: Array<[string, number, number]> = [
    ['just started (full duration remaining)', END_MS - FIVE_MIN, 0],
    ['a fifth in', END_MS - FIVE_MIN * 0.8, 0.2],
    ['halfway', END_MS - FIVE_MIN / 2, 0.5],
    ['nearly done', END_MS - FIVE_MIN * 0.1, 0.9],
    ['exactly at the end', END_MS, 1],
  ];

  it.each(cases)('%s → %d', (_label, nowMs, expected) => {
    expect(timerProgress(TIMER, FIVE_MIN, nowMs)).toBeCloseTo(expected, 10);
  });

  it('clamps to 1 once the timer has overrun', () => {
    expect(timerProgress(TIMER, FIVE_MIN, END_MS + 60_000)).toBe(1);
    expect(timerProgress(TIMER, FIVE_MIN, END_MS + 86_400_000)).toBe(1);
  });

  it('clamps to 0 when more time remains than the duration allows', () => {
    // Happens when the recipe's duration is edited DOWN mid-run: the ratio is
    // clamped rather than wrong, and the "recipe was updated" banner is already up.
    expect(timerProgress(TIMER, FIVE_MIN, END_MS - FIVE_MIN * 3)).toBe(0);
  });

  // ─── No fill rather than a bogus one ────────────────────────────────────────
  const noFill: Array<[string, number | null | undefined]> = [
    ['the step was deleted from the recipe (null)', null],
    ['the step has no timer any more (undefined)', undefined],
    ['the duration is zero', 0],
  ];

  it.each(noFill)('returns null when %s', (_label, durationMs) => {
    expect(timerProgress(TIMER, durationMs, END_MS - 1000)).toBeNull();
  });

  it('reads no clock — the same nowMs always gives the same answer', () => {
    const at = END_MS - 90_000;
    expect(timerProgress(TIMER, FIVE_MIN, at)).toBe(timerProgress(TIMER, FIVE_MIN, at));
  });

  it('scales with the step duration, not with wall-clock elapsed time', () => {
    // Two minutes left reads very differently on a 5-minute rest than on a
    // 40-minute braise — which is the whole point of the fill.
    const twoMinutesLeft = END_MS - 120_000;
    expect(timerProgress(TIMER, FIVE_MIN, twoMinutesLeft)).toBeCloseTo(0.6, 10);
    expect(timerProgress(TIMER, 40 * 60_000, twoMinutesLeft)).toBeCloseTo(0.95, 10);
  });
});
