import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVEAL_SHIMMER_MS, createMatchReveal } from '../src/lib/matchReveal.svelte.js';

// The match-reveal detector's whole contract is "observe, never write": it reads
// the real `matchState` for the pending→matched landing and lights the one-shot
// tile shimmer, and it must NOT fire for anything that only *looks* like an
// arrival (a first sighting on load, a streamed-in already-matched row, a re-add).
// These tests pin the genuine-transition rule, the timed release, and the
// reduced-motion escape hatch.

type MatchState = 'pending' | 'matched' | 'needs_approval' | 'failed';
function item(id: string, matchState: MatchState) {
  return { id, matchState };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createMatchReveal — detecting the match landing', () => {
  it('reveals an id that we watched as pending and then saw become matched', () => {
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'pending')]);
    expect(reveal.isRevealing('a')).toBe(false);

    reveal.observe([item('a', 'matched')]);
    expect(reveal.isRevealing('a')).toBe(true);
  });

  it('does NOT reveal a first sighting that is already matched (stream-in / load)', () => {
    const reveal = createMatchReveal();

    // The very first time we see this id it is already matched — it was always
    // matched as far as we know, so it must not shimmer.
    reveal.observe([item('a', 'matched')]);
    expect(reveal.isRevealing('a')).toBe(false);

    // And it stays quiet on subsequent stable renders.
    reveal.observe([item('a', 'matched')]);
    expect(reveal.isRevealing('a')).toBe(false);
  });

  it('reveals from any non-matched state (needs_approval → matched, failed → matched)', () => {
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'needs_approval'), item('b', 'failed')]);
    reveal.observe([item('a', 'matched'), item('b', 'matched')]);

    expect(reveal.isRevealing('a')).toBe(true);
    expect(reveal.isRevealing('b')).toBe(true);
  });

  it('reveals only the id that actually transitioned, leaving stable rows alone', () => {
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'matched'), item('b', 'pending')]);
    reveal.observe([item('a', 'matched'), item('b', 'matched')]);

    expect(reveal.isRevealing('a')).toBe(false);
    expect(reveal.isRevealing('b')).toBe(true);
  });

  it('re-reveals when a row cycles matched → pending → matched again', () => {
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'pending')]);
    reveal.observe([item('a', 'matched')]);
    expect(reveal.isRevealing('a')).toBe(true);

    vi.advanceTimersByTime(REVEAL_SHIMMER_MS);
    expect(reveal.isRevealing('a')).toBe(false);

    // Edit re-triggers matching: back to pending, then matched again → reveal again.
    reveal.observe([item('a', 'pending')]);
    reveal.observe([item('a', 'matched')]);
    expect(reveal.isRevealing('a')).toBe(true);
  });

  it('treats a re-added id as a first sighting (no reveal) after it left the list', () => {
    const reveal = createMatchReveal();

    // Seen as pending, then it disappears (deleted) before matching.
    reveal.observe([item('a', 'pending')]);
    reveal.observe([]);
    // It comes back already matched (e.g. re-added and instantly matched, or a late
    // snapshot). Because we forgot it, this is a fresh first sighting → no reveal.
    reveal.observe([item('a', 'matched')]);
    expect(reveal.isRevealing('a')).toBe(false);
  });
});

describe('createMatchReveal — letting go', () => {
  it('releases the id once the shimmer window has run', () => {
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'pending')]);
    reveal.observe([item('a', 'matched')]);

    vi.advanceTimersByTime(REVEAL_SHIMMER_MS - 1);
    expect(reveal.isRevealing('a')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(reveal.isRevealing('a')).toBe(false);
  });

  it('drops the reveal immediately if the row leaves the list mid-shimmer', () => {
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'pending')]);
    reveal.observe([item('a', 'matched')]);
    expect(reveal.isRevealing('a')).toBe(true);

    // Deleted out from under the shimmer — forget it now, don't leave a stale flag.
    reveal.observe([]);
    expect(reveal.isRevealing('a')).toBe(false);
    expect(reveal.revealingIds.size).toBe(0);
  });

  it('cancels every pending reveal on dispose, so no timer outlives the page', () => {
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'pending'), item('b', 'pending')]);
    reveal.observe([item('a', 'matched'), item('b', 'matched')]);
    expect(reveal.revealingIds.size).toBe(2);

    reveal.dispose();
    expect(reveal.revealingIds.size).toBe(0);

    // Nothing left to fire.
    vi.advanceTimersByTime(REVEAL_SHIMMER_MS * 2);
    expect(reveal.revealingIds.size).toBe(0);
  });
});

describe('createMatchReveal — reduced motion', () => {
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

  it('never reveals under reduced motion — the tile just snaps sage', () => {
    preferReducedMotion();
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'pending')]);
    reveal.observe([item('a', 'matched')]);

    expect(reveal.isRevealing('a')).toBe(false);
    expect(reveal.revealingIds.size).toBe(0);
  });

  it('leaves no timer behind when it declines to reveal', () => {
    preferReducedMotion();
    const reveal = createMatchReveal();

    reveal.observe([item('a', 'pending')]);
    reveal.observe([item('a', 'matched')]);
    vi.advanceTimersByTime(REVEAL_SHIMMER_MS * 2);

    expect(reveal.revealingIds.size).toBe(0);
  });
});
