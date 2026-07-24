import { describe, it, expect } from 'vitest';

import {
  resolveSwipe,
  crossedThreshold,
  isHorizontalDrag,
  revealProgress,
  CHECK_THRESHOLD_PX,
  DELETE_THRESHOLD_PX,
  DRAG_START_PX,
} from '../src/lib/swipe.js';

// The pure geometry behind the touch-only shopping-row swipe (Phase 4). These tests
// state the FEEL rules in words — "right past the line checks, left past it deletes,
// a short swipe springs back" — because that is what a change here would break. The
// DOM half (pointer capture, pan-y, the spring-back transition) lives in the action
// and is covered by the e2e; everything decidable from numbers alone lives here.

describe('resolveSwipe — which action a released drag lands on', () => {
  it('a swipe right past +78px checks the item', () => {
    expect(resolveSwipe(CHECK_THRESHOLD_PX)).toBe('check');
    expect(resolveSwipe(120)).toBe('check');
  });

  it('a swipe left past -78px deletes it', () => {
    expect(resolveSwipe(-DELETE_THRESHOLD_PX)).toBe('delete');
    expect(resolveSwipe(-200)).toBe('delete');
  });

  it('the threshold is inclusive — landing exactly on +78 / -78 commits', () => {
    expect(resolveSwipe(78)).toBe('check');
    expect(resolveSwipe(-78)).toBe('delete');
  });

  it('a short swipe in either direction springs back (no commit)', () => {
    expect(resolveSwipe(0)).toBe('none');
    expect(resolveSwipe(77)).toBe('none');
    expect(resolveSwipe(-77)).toBe('none');
    expect(resolveSwipe(40)).toBe('none');
    expect(resolveSwipe(-40)).toBe('none');
  });
});

describe('crossedThreshold — the one moment to fire a haptic tick', () => {
  it('fires when the drag first crosses out past the line', () => {
    expect(crossedThreshold(70, 80)).toBe(true); // into check
    expect(crossedThreshold(-70, -80)).toBe(true); // into delete
  });

  it('does not fire again while the drag stays committed', () => {
    expect(crossedThreshold(80, 100)).toBe(false);
    expect(crossedThreshold(-80, -140)).toBe(false);
  });

  it('does not fire while the drag stays under the line', () => {
    expect(crossedThreshold(0, 40)).toBe(false);
    expect(crossedThreshold(40, 60)).toBe(false);
    expect(crossedThreshold(-10, -50)).toBe(false);
  });

  it('fires anew if the finger retreats under and crosses out again', () => {
    // 90 → 40 (fell back under) → 90 (crossed out again) fires on the second crossing.
    expect(crossedThreshold(40, 90)).toBe(true);
  });
});

describe('isHorizontalDrag — the tap / vertical-scroll guard', () => {
  it('claims the drag once horizontal travel clears the slop and dominates vertical', () => {
    expect(isHorizontalDrag(DRAG_START_PX + 1, 0)).toBe(true);
    expect(isHorizontalDrag(30, 10)).toBe(true);
    expect(isHorizontalDrag(-30, 10)).toBe(true);
  });

  it('leaves a stationary tap alone (never claims within the slop)', () => {
    expect(isHorizontalDrag(0, 0)).toBe(false);
    expect(isHorizontalDrag(DRAG_START_PX, 0)).toBe(false);
    expect(isHorizontalDrag(4, 2)).toBe(false);
  });

  it('leaves a vertical pan to pan-y (vertical travel dominates)', () => {
    expect(isHorizontalDrag(10, 40)).toBe(false);
    expect(isHorizontalDrag(-10, 40)).toBe(false);
    expect(isHorizontalDrag(20, 20)).toBe(false); // a diagonal tie is not horizontal
  });
});

describe('revealProgress — how far the reveal-behind layer shows', () => {
  it('is a signed fraction: positive = check (right), negative = delete (left)', () => {
    expect(revealProgress(0)).toBe(0);
    expect(revealProgress(39)).toBeCloseTo(0.5, 5);
    expect(revealProgress(-39)).toBeCloseTo(-0.5, 5);
  });

  it('caps at fully revealed once past the threshold', () => {
    expect(revealProgress(CHECK_THRESHOLD_PX)).toBe(1);
    expect(revealProgress(200)).toBe(1);
    expect(revealProgress(-DELETE_THRESHOLD_PX)).toBe(-1);
    expect(revealProgress(-200)).toBe(-1);
  });
});
