import { describe, it, expect } from 'vitest';

import {
  deriveStops,
  nearestStopIndex,
  rubberBand,
  chooseLandingStop,
  sectionMinHeight,
  fadeHeightFor,
  PEEK_PX,
  PEEK_MAX_PX,
  FADE_MIN_PX,
  RUBBER_BAND,
} from '../src/lib/cookDeck.js';

// The deck geometry behind cook mode's one-step-per-screen pager. These tests state the
// FEEL rules in words — "a fling always turns at least one page" — because that is what a
// change here would break; the numbers themselves are tuning, and this suite is what says
// which of them are load-bearing.

// A phone-ish screen, and a recipe of four screen-sized steps stacked in a deck.
const SCREEN = 800;
const FOUR_STEPS = [
  { top: 0, height: SCREEN },
  { top: SCREEN, height: SCREEN },
  { top: SCREEN * 2, height: SCREEN },
  { top: SCREEN * 3, height: SCREEN },
];
// Three screens of travel behind a four-screen deck.
const LIMIT = SCREEN * 3;
const STOPS = [0, 800, 1600, 2400];

describe('where the deck is allowed to rest', () => {
  it('gives every step a resting place of its own', () => {
    expect(deriveStops({ sections: FOUR_STEPS, screen: SCREEN, limit: LIMIT })).toEqual(STOPS);
  });

  it('a step taller than the screen contributes intermediate stops a screen apart', () => {
    // One very long instruction: without the extra stops its middle would be unreachable,
    // because the deck could only rest at its top and at the top of whatever follows.
    const stops = deriveStops({
      sections: [{ top: 0, height: SCREEN * 3 }],
      screen: SCREEN,
      limit: LIMIT,
    });
    expect(stops).toEqual([0, 800, 1600]);
  });

  it('a step that only just overhangs the screen does not earn a stop of its own', () => {
    // A few pixels of layout noise must not mint a stop a hair below the one already there.
    const stops = deriveStops({
      sections: [{ top: 0, height: SCREEN + 4 }],
      screen: SCREEN,
      limit: LIMIT,
    });
    expect(stops).toEqual([0]);
  });

  it('never offers a stop past the end of the deck', () => {
    const stops = deriveStops({ sections: FOUR_STEPS, screen: SCREEN, limit: 1000 });
    expect(Math.max(...stops)).toBe(1000);
  });

  it('counts steps that share a resting place as one stop', () => {
    // A run of collapsed done-steps all sit at the same place once clamped — paging must
    // not need one swipe per step to get through them.
    const stops = deriveStops({
      sections: [
        { top: 2400, height: 60 },
        { top: 2460, height: 60 },
        { top: 2520, height: 60 },
      ],
      screen: SCREEN,
      limit: 2400,
    });
    expect(stops).toEqual([2400]);
  });

  it('lists its stops in order, from the top of the recipe down', () => {
    const stops = deriveStops({
      sections: [
        { top: 1600, height: SCREEN },
        { top: 0, height: SCREEN },
        { top: 800, height: SCREEN },
      ],
      screen: SCREEN,
      limit: LIMIT,
    });
    expect(stops).toEqual([0, 800, 1600]);
  });

  it('rests only at the top until the viewport has been measured', () => {
    expect(deriveStops({ sections: FOUR_STEPS, screen: 0, limit: LIMIT })).toEqual([0]);
  });

  it('has nowhere to rest when the recipe has no steps', () => {
    expect(deriveStops({ sections: [], screen: SCREEN, limit: 0 })).toEqual([]);
  });
});

describe('which step the deck is nearest', () => {
  it('picks the stop it is closest to', () => {
    expect(nearestStopIndex(0, STOPS)).toBe(0);
    expect(nearestStopIndex(900, STOPS)).toBe(1);
    expect(nearestStopIndex(2399, STOPS)).toBe(3);
  });

  it('stays on the step it came from when it is exactly between two', () => {
    expect(nearestStopIndex(400, STOPS)).toBe(0);
  });

  it('treats a deck with no stops as sitting at the top', () => {
    expect(nearestStopIndex(1234, [])).toBe(0);
  });
});

describe('dragging past the ends of the recipe', () => {
  it('tracks the finger exactly while there is recipe left to travel', () => {
    expect(rubberBand(0, LIMIT, RUBBER_BAND)).toBe(0);
    expect(rubberBand(950, LIMIT, RUBBER_BAND)).toBe(950);
    expect(rubberBand(LIMIT, LIMIT, RUBBER_BAND)).toBe(LIMIT);
  });

  it('resists past the first step, so the top feels like an end rather than a wall', () => {
    expect(rubberBand(-200, LIMIT, RUBBER_BAND)).toBeCloseTo(-70, 6);
  });

  it('resists past the last step in the same way', () => {
    expect(rubberBand(LIMIT + 200, LIMIT, RUBBER_BAND)).toBeCloseTo(LIMIT + 70, 6);
  });
});

describe('where a released swipe lands', () => {
  const settle = (over: Partial<Parameters<typeof chooseLandingStop>[0]>): number =>
    chooseLandingStop({
      stops: STOPS,
      startIndex: 0,
      offset: 0,
      dragged: 0,
      velocity: 0,
      screen: SCREEN,
      ...over,
    });

  it('a slow drag past the commit ratio turns exactly one page', () => {
    // ~25% of a screen, dragged slowly: enough to commit, not enough to project past the
    // next step. One page, not two.
    expect(settle({ offset: 200, dragged: 200, velocity: 0.1 })).toBe(1);
  });

  it('a slow drag that never reaches the commit ratio falls back where it started', () => {
    expect(settle({ startIndex: 1, offset: 900, dragged: 100, velocity: 0.1 })).toBe(1);
  });

  it('a fling always turns at least one page even when it started near a stop', () => {
    // Barely moved — projecting it forward would land back on the stop it came from, and
    // a swipe that changes nothing reads as a swipe that was ignored.
    expect(settle({ offset: 30, dragged: 30, velocity: 0.6 })).toBe(1);
  });

  it('a fling backwards always turns at least one page too', () => {
    expect(settle({ startIndex: 2, offset: 1570, dragged: -30, velocity: -0.6 })).toBe(1);
  });

  it('a hard fling can cross several pages at once', () => {
    // What stops a run of collapsed done-steps needing a swipe each.
    expect(settle({ offset: 100, dragged: 100, velocity: 6 })).toBe(2);
    expect(settle({ startIndex: 3, offset: 2300, dragged: -100, velocity: -6 })).toBe(1);
  });

  it('cannot be flung past the last step', () => {
    expect(settle({ startIndex: 3, offset: 2400, dragged: 40, velocity: 6 })).toBe(3);
  });

  it('cannot be flung back past the first step', () => {
    expect(settle({ startIndex: 0, offset: 0, dragged: -40, velocity: -6 })).toBe(0);
  });

  it('a slow drag decides its direction by where the finger went, not how fast', () => {
    // Below the fling speed, only the distance dragged says which way the page turns.
    expect(settle({ startIndex: 2, offset: 1400, dragged: -200, velocity: -0.1 })).toBe(1);
  });
});

describe('how tall a step is', () => {
  it("a short step's section floors at the screen less the biggest peek", () => {
    expect(sectionMinHeight(900)).toBe(900 - PEEK_MAX_PX);
  });

  it('never asks for a negative height on a very short screen', () => {
    expect(sectionMinHeight(100)).toBe(0);
    expect(sectionMinHeight(0)).toBe(0);
  });

  it('leaves room for at least a full peek of the next step', () => {
    expect(900 - sectionMinHeight(900)).toBeGreaterThanOrEqual(PEEK_PX);
  });
});

describe('the fade over the peeking next step', () => {
  it('covers exactly the gap the current step left below itself', () => {
    expect(fadeHeightFor(150)).toBe(150);
  });

  it('never reaches further than the deck can ever peek', () => {
    expect(fadeHeightFor(1000)).toBe(PEEK_MAX_PX);
  });

  it('never drops below its floor, even when the step fills the screen', () => {
    expect(fadeHeightFor(10)).toBe(FADE_MIN_PX);
    // A step taller than the viewport reports a negative gap; the bottom-edge fade is
    // then the only cue left that there is more below.
    expect(fadeHeightFor(-120)).toBe(FADE_MIN_PX);
  });

  it('stays between its floor and the peek for every gap a layout can produce', () => {
    for (const gap of [-500, -1, 0, 63.4, 64, 150, 223.5, 224, 500]) {
      const fade = fadeHeightFor(gap);
      expect(fade).toBeGreaterThanOrEqual(FADE_MIN_PX);
      expect(fade).toBeLessThanOrEqual(PEEK_MAX_PX);
    }
  });

  it('lands on whole pixels', () => {
    expect(fadeHeightFor(150.4)).toBe(150);
    expect(fadeHeightFor(150.6)).toBe(151);
  });
});
