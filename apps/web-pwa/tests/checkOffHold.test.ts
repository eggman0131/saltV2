import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_OFF_HOLD_MS, createCheckOffHold } from '../src/lib/checkOffHold.svelte.js';

// The check-off celebration's whole contract is "write now, animate after": the
// Firestore write is never this module's business, and all it may do is keep a
// row's PLACE for as long as the outro runs. These tests pin the two halves of
// that — the row keeps rendering where it was (not merely "is hidden"), and it
// lets go on its own — plus the reduced-motion escape hatch, which has to skip
// the hold entirely rather than play it invisibly.

// `holdInPlace` reads exactly two fields, so the fixtures are exactly two fields.
function row(id: string, checked = false) {
  return { id, checked };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createCheckOffHold — holding a checked row in place', () => {
  it('hands a held row on as still-unchecked, so it groups where it already was', () => {
    const hold = createCheckOffHold();
    hold.begin(['a']);

    // The optimistic write has already flipped the real item to checked.
    const [held] = hold.holdInPlace([row('a', true)]);

    expect(held?.checked).toBe(false);
    expect(hold.isExiting('a')).toBe(true);
  });

  it('leaves every other row untouched, checked or not', () => {
    const hold = createCheckOffHold();
    hold.begin(['a']);

    const items = [row('a', true), row('b', false), row('c', true)];
    const result = hold.holdInPlace(items);

    expect(result.map((i) => i.checked)).toEqual([false, false, true]);
    // Untouched rows are the SAME objects — no gratuitous re-render.
    expect(result[1]).toBe(items[1]);
    expect(result[2]).toBe(items[2]);
  });

  it('returns the very same array when nothing is being held', () => {
    const hold = createCheckOffHold();
    const items = [row('a', true), row('b')];

    expect(hold.holdInPlace(items)).toBe(items);
  });

  it('does not resurrect a row that was already checked before the tap', () => {
    // Only the row the user just tapped is inverted; the Checked section's own
    // rows are held-adjacent at most and must stay checked.
    const hold = createCheckOffHold();
    hold.begin(['a']);

    const result = hold.holdInPlace([row('b', true)]);

    expect(result[0]?.checked).toBe(true);
  });
});

describe('createCheckOffHold — letting go', () => {
  it('releases the row once the hold window has run, so it lands in Checked', () => {
    const hold = createCheckOffHold();
    hold.begin(['a']);

    vi.advanceTimersByTime(CHECK_OFF_HOLD_MS - 1);
    expect(hold.isExiting('a')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(hold.isExiting('a')).toBe(false);
    expect(hold.holdInPlace([row('a', true)])[0]?.checked).toBe(true);
  });

  it('holds every contributor of a combined row as one unit', () => {
    const hold = createCheckOffHold();
    hold.begin(['a', 'b', 'c']);

    expect(
      hold.holdInPlace([row('a', true), row('b', true), row('c', true)]).every((i) => !i.checked),
    ).toBe(true);

    vi.advanceTimersByTime(CHECK_OFF_HOLD_MS);

    expect(hold.exitingIds.size).toBe(0);
  });

  it('neither extends nor duplicates a hold when the same row is tapped again', () => {
    const hold = createCheckOffHold();
    hold.begin(['a']);

    vi.advanceTimersByTime(CHECK_OFF_HOLD_MS / 2);
    hold.begin(['a']);
    vi.advanceTimersByTime(CHECK_OFF_HOLD_MS / 2);

    // Released on the ORIGINAL schedule — a re-tap must not park the row forever.
    expect(hold.isExiting('a')).toBe(false);
  });

  it('can drop a hold early, for a row deleted out from under it', () => {
    const hold = createCheckOffHold();
    hold.begin(['a', 'b']);

    hold.release(['a']);

    expect(hold.isExiting('a')).toBe(false);
    expect(hold.isExiting('b')).toBe(true);
  });

  it('cancels every pending hold on dispose, so no timer outlives the page', () => {
    const hold = createCheckOffHold();
    hold.begin(['a', 'b']);

    hold.dispose();

    expect(hold.exitingIds.size).toBe(0);
    // Nothing left to fire: advancing past the window changes nothing.
    vi.advanceTimersByTime(CHECK_OFF_HOLD_MS * 2);
    expect(hold.exitingIds.size).toBe(0);
  });
});

describe('createCheckOffHold — reduced motion', () => {
  const realMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  function preferReducedMotion(): void {
    window.matchMedia = ((query: string) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it('skips the hold entirely — the row moves the instant it is checked', () => {
    preferReducedMotion();
    const hold = createCheckOffHold();

    hold.begin(['a']);

    // Not "held but not animated": never held at all, which is today's behaviour.
    expect(hold.isExiting('a')).toBe(false);
    expect(hold.holdInPlace([row('a', true)])[0]?.checked).toBe(true);
  });

  it('leaves no timer behind when it declines to hold', () => {
    preferReducedMotion();
    const hold = createCheckOffHold();

    hold.begin(['a']);
    vi.advanceTimersByTime(CHECK_OFF_HOLD_MS * 2);

    expect(hold.exitingIds.size).toBe(0);
  });
});
