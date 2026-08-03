import { describe, it, expect } from 'vitest';

import {
  FULL_TOP_GAP_PX,
  PEEK_FRACTION,
  deriveDrawerStops,
} from '../src/routes/recipes/chatDrawer.js';

// The chat drawer's two stops (issue #696). Pure arithmetic, no DOM — the component
// measures, this decides. What the numbers have to guarantee is the feature itself: both
// the chef and the recipe on screen at the resting stop, and never the whole page covered
// at the taller one.

// A Pixel-ish phone: 851 tall, drawer bottom above a 56px BottomNav.
const PHONE_H = 851;
const PHONE_BOTTOM = PHONE_H - 56;

describe('deriveDrawerStops', () => {
  it('rests at about 45% of the screen', () => {
    const { peek } = deriveDrawerStops(PHONE_BOTTOM, PHONE_H);

    expect(peek).toBe(Math.round(PHONE_H * PEEK_FRACTION));
  });

  it('leaves the page header showing at the full stop', () => {
    // #641's defect was chrome left focusable under an overlay that covered it. A
    // non-modal drawer that covers everything is the same bug.
    const { full } = deriveDrawerStops(PHONE_BOTTOM, PHONE_H);

    expect(full).toBe(PHONE_BOTTOM - FULL_TOP_GAP_PX);
    expect(PHONE_H - full).toBeGreaterThanOrEqual(FULL_TOP_GAP_PX);
  });

  it('leaves the recipe more than half the screen at rest', () => {
    const { peek } = deriveDrawerStops(PHONE_BOTTOM, PHONE_H);

    expect(peek).toBeLessThan(PHONE_H / 2);
  });

  it('gives the full stop real travel above the peek', () => {
    const { peek, full } = deriveDrawerStops(PHONE_BOTTOM, PHONE_H);

    expect(full).toBeGreaterThan(peek);
  });

  it('measures the bottom edge rather than assuming it — the nav and safe area move it', () => {
    const withInset = deriveDrawerStops(PHONE_BOTTOM - 34, PHONE_H);
    const without = deriveDrawerStops(PHONE_BOTTOM, PHONE_H);

    expect(withInset.full).toBe(without.full - 34);
    // The peek is a share of the SCREEN, not of the band, so it is unmoved.
    expect(withInset.peek).toBe(without.peek);
  });

  it('never inverts the travel on a screen too short for two stops', () => {
    // A landscape phone, or a measurement taken before layout. A full stop shorter than
    // the peek would drag the wrong way; collapsing them just removes the second stop.
    const { peek, full } = deriveDrawerStops(300, 340);

    expect(peek).toBeLessThanOrEqual(full);
  });

  it('is safe before anything has been laid out', () => {
    expect(deriveDrawerStops(0, 0)).toEqual({ peek: 0, full: 0 });
  });
});
