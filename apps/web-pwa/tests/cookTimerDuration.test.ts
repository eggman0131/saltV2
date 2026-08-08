import { describe, it, expect } from 'vitest';
import {
  parseMinutes,
  stepMinutesDown,
  stepMinutesUp,
} from '../src/routes/recipes/cookTimerDuration.js';

/** Tap `+` n times from `start`, collecting every value on the way. */
function tapUp(start: number, taps: number): number[] {
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < taps; i += 1) {
    v = stepMinutesUp(v);
    out.push(v);
  }
  return out;
}

function tapDown(start: number, taps: number): number[] {
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < taps; i += 1) {
    v = stepMinutesDown(v);
    out.push(v);
  }
  return out;
}

describe('cook timer duration — the −/+ chips', () => {
  it('moves a minute at a time below the half-hour and five at a time above it', () => {
    expect(tapUp(28, 4)).toEqual([29, 30, 35, 40]);
  });

  it('retraces exactly the same sequence coming back down', () => {
    expect(tapDown(40, 4)).toEqual([35, 30, 29, 28]);
  });

  // The one thing a stepper must not do: quietly round a number the cook typed on
  // purpose. 32 is 32-shaped, and one tap up and one tap down returns to it.
  it('never snaps a typed value onto a multiple of five', () => {
    expect(stepMinutesUp(32)).toBe(37);
    expect(stepMinutesDown(37)).toBe(32);
    expect(stepMinutesDown(stepMinutesUp(32))).toBe(32);
  });

  it('stops at one minute rather than counting down to nothing', () => {
    expect(tapDown(3, 5)).toEqual([2, 1, 1, 1, 1]);
  });

  it('reads a typed duration, and refuses anything that is not one', () => {
    expect(parseMinutes('12')).toBe(12);
    expect(parseMinutes(' 45 ')).toBe(45);
    // Mid-typing, and the two ways a field ends up meaningless.
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('abc')).toBeNull();
    // Whole minutes only — the chips could never return to a half.
    expect(parseMinutes('2.5')).toBeNull();
    // A timer that has already finished is not a timer.
    expect(parseMinutes('0')).toBeNull();
    expect(parseMinutes('-5')).toBeNull();
  });
});
