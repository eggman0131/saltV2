import { describe, it, expect } from 'vitest';
import { chooseLandingStop, deriveStops } from '../src/lib/cookDeck.js';

// The planner's deck (#639, Phase 4) reuses cook mode's geometry against sections
// of a completely different size: a day card is ~200px where a cook step fills the
// screen. These tests pin the thresholds the planner passes, because that choice is
// the whole of the difference and it is easy to get backwards — `commitRatio` is a
// fraction of the VIEWPORT, not of a section, so SHORTER cards want a SMALLER ratio.
//
// The page's own wiring is covered in MealPlanWeekPage.test.ts; everything here is
// pure arithmetic and needs no DOM.

const PLANNER_THRESHOLDS = { commitRatio: 0.08, flingPxPerMs: 0.35 };

const ROW_H = 200;
const ROW_GAP = 24;
const ROW_PITCH = ROW_H + ROW_GAP;
const SCREEN = 700;

/** Seven day cards, 24px apart — one planner week. */
const WEEK = Array.from({ length: 7 }, (_, i) => ({ top: i * ROW_PITCH, height: ROW_H }));
const LIMIT = 7 * ROW_H + 6 * ROW_GAP - SCREEN; // 844

describe('the planner deck rests on day headers', () => {
  it('offers a stop at every day, not one screen at a time', () => {
    const stops = deriveStops({ sections: WEEK, screen: SCREEN, limit: LIMIT });
    // Several days are visible at rest, so every day is reachable as a stop —
    // this is a snap, not one-day-per-screen.
    expect(stops.slice(0, 4)).toEqual([0, ROW_PITCH, 2 * ROW_PITCH, 3 * ROW_PITCH]);
  });

  it('never rests past the end of the list', () => {
    const stops = deriveStops({ sections: WEEK, screen: SCREEN, limit: LIMIT });
    for (const stop of stops) expect(stop).toBeLessThanOrEqual(LIMIT);
    expect(Math.max(...stops)).toBe(LIMIT);
  });
});

describe('the planner deck commits on a day-sized drag', () => {
  const land = (dragged: number, velocity = 0, overrides = PLANNER_THRESHOLDS): number => {
    const stops = deriveStops({ sections: WEEK, screen: SCREEN, limit: LIMIT });
    return chooseLandingStop({
      stops,
      startIndex: 0,
      offset: dragged,
      dragged,
      velocity,
      screen: SCREEN,
      ...overrides,
    });
  };

  it('turns the day on a drag of about a third of a card', () => {
    // 0.08 × 700 ≈ 56px. A deliberate drag past that commits to the next day…
    expect(land(70)).toBe(1);
    // …and a small one falls back to where it started.
    expect(land(30)).toBe(0);
  });

  it("would almost never commit on cook mode's ratio", () => {
    // The trap this tuning exists to avoid: 0.22 × 700 = 154px, most of a card, so
    // an ordinary drag would spring back and the deck would feel stuck.
    expect(land(70, 0, { commitRatio: 0.22, flingPxPerMs: 0.35 })).toBe(0);
  });

  it('turns at least one day on a light flick', () => {
    // Barely moved, but thrown — velocity alone must carry it.
    expect(land(12, 0.4)).toBeGreaterThanOrEqual(1);
  });

  it('carries further the harder it is thrown', () => {
    expect(land(12, 1.6)).toBeGreaterThan(land(12, 0.4));
  });
});
