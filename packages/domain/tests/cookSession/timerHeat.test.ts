import { describe, it, expect } from 'vitest';
import { timerHeat, heatWantsAttention, type TimerHeat } from '../../src/index.js';

// The four states a countdown passes through. One decision in one place, so the
// dial's sweep, the card's state word and the nav badge cannot drift apart —
// which is the whole reason this is a domain helper and not a ternary on a page.

const MIN = 60_000;

describe('timerHeat', () => {
  it('is resting while there is more than ten minutes to run', () => {
    expect(timerHeat(60 * MIN)).toBe('resting');
    expect(timerHeat(10 * MIN)).toBe('resting');
  });

  it('is soon below ten minutes, down to two', () => {
    expect(timerHeat(10 * MIN - 1)).toBe('soon');
    expect(timerHeat(5 * MIN)).toBe('soon');
    expect(timerHeat(2 * MIN)).toBe('soon');
  });

  it('is imminent below two minutes', () => {
    expect(timerHeat(2 * MIN - 1)).toBe('imminent');
    expect(timerHeat(30_000)).toBe('imminent');
    expect(timerHeat(1)).toBe('imminent');
  });

  it('holds the calmer state AT each threshold, and flips one millisecond under', () => {
    // Pinned deliberately: "under ten minutes" is exclusive, so a timer reading
    // exactly 10:00 has not started warming up yet. Both edges stated together
    // so a later tweak to one cannot quietly disagree with the other.
    expect(timerHeat(10 * MIN)).toBe('resting');
    expect(timerHeat(10 * MIN - 1)).toBe('soon');
    expect(timerHeat(2 * MIN)).toBe('soon');
    expect(timerHeat(2 * MIN - 1)).toBe('imminent');
  });

  it('is ringing the instant it reaches zero, and stays there', () => {
    // A fired timer sits in `activeTimers` until somebody dismisses it, so
    // however long ago it went off, it is still going off.
    expect(timerHeat(0)).toBe('ringing');
    expect(timerHeat(-1)).toBe('ringing');
    expect(timerHeat(-6 * 60 * MIN)).toBe('ringing');
  });

  it('treats an untimeable timer as ringing rather than calm', () => {
    // An unparseable `endsAt` yields NaN. Reading that as "resting" would hide
    // the one timer most worth looking at.
    expect(timerHeat(Number.NaN)).toBe('ringing');
  });

  it('only ever increases in urgency as time runs out', () => {
    // The screen this replaced painted a RUNNING timer amber and a FIRED one
    // primary, so the calmer colour arrived at the louder moment. Guard that.
    const order: TimerHeat[] = ['resting', 'soon', 'imminent', 'ringing'];
    const samples = [60 * MIN, 20 * MIN, 10 * MIN, 3 * MIN, 90_000, 5_000, 0, -MIN];
    const ranks = samples.map((ms) => order.indexOf(timerHeat(ms)));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
    }
  });
});

describe('heatWantsAttention', () => {
  it('is true only once the timer has actually fired', () => {
    // A timer counting down is running to plan; the badge is for things that
    // want a hand, which is the same bargain `mineOpenCount` strikes.
    expect(heatWantsAttention('ringing')).toBe(true);
    expect(heatWantsAttention('imminent')).toBe(false);
    expect(heatWantsAttention('soon')).toBe(false);
    expect(heatWantsAttention('resting')).toBe(false);
  });
});
