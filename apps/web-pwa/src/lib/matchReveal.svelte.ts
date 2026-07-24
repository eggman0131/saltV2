import { prefersReducedMotion } from './reducedMotion.js';

/**
 * Match-reveal detector for the shopping list's "it found its home" moment
 * (lively list, Phase 3).
 *
 * OBSERVE, NEVER WRITE. `matchState` is real, already-reactive Firestore state
 * (`'pending' | 'matched' | 'needs_approval' | 'failed'`); this only *watches* it
 * for the instant a row's match lands and lights up the reveal — the one-shot
 * CanonIcon shimmer. It writes nothing back: no schema field, no persisted
 * `isAnimating`/`revealed` flag, and it is per-component, not global.
 *
 * The signal is a genuine transition, tracked component-locally against the
 * PREVIOUS `matchState` we saw for each id (a plain, non-reactive Map). A reveal
 * fires only when we watched an item as some non-matched state and it just became
 * `matched`. A first sighting is deliberately NOT a reveal: a row that streams in
 * already `matched` (page load, a late Firestore snapshot, a view filter
 * un-hiding it) was always matched *as far as we ever saw*, so it must not
 * shimmer — that is what keeps a cold load from firing a storm of reveals.
 *
 * The move itself (Other → aisle) is choreographed separately by Svelte
 * `crossfade` on the row; this detector owns only the tile flourish, which is a
 * CSS one-shot and therefore needs its trigger held `true` for the length of the
 * sweep. So a revealed id is parked in a reactive set for `shimmerMs`, then
 * released — exactly the shape of `createCheckOffHold`, and disposed the same way.
 *
 * Under reduced motion `observe` still commits its bookkeeping (so a later
 * genuine transition is detected correctly) but reveals nothing: the set stays
 * empty, the shimmer prop never goes true, and the whole treatment falls back to
 * today's instant snap.
 */

/** The one `matchState` shape `observe` reads; the shopping item carries more. */
type MatchState = 'pending' | 'matched' | 'needs_approval' | 'failed';

/** All `observe` needs of an item: identity and its current match state. */
export interface RevealableItem {
  readonly id: string;
  readonly matchState: MatchState;
}

/**
 * How long a freshly-matched id stays "revealing" (the shimmer prop true), in ms.
 * Must comfortably exceed the CSS sweep in salt.css (`salt-icon-shimmer`, driven
 * by `--duration-slow` = 260ms) so the one-shot animation completes before the
 * overlay unmounts; the surplus also covers the brief lag between the match
 * landing and the row arriving in its aisle (canon-into-local-map sync).
 */
export const REVEAL_SHIMMER_MS = 900;

export function createMatchReveal(shimmerMs: number = REVEAL_SHIMMER_MS) {
  // Reassigned, never mutated — the Svelte 5 rune convention used elsewhere on
  // the page (`collapsedAisles`, the check-off hold's `exiting` set).
  let revealing = $state(new Set<string>());
  // Non-reactive: the previous match state per id. Read imperatively inside
  // `observe`; it must NOT be reactive, or committing it would loop the effect.
  const prev = new Map<string, MatchState>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function release(id: string): void {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    if (revealing.has(id)) {
      const next = new Set(revealing);
      next.delete(id);
      revealing = next;
    }
  }

  return {
    /** Reactive set of ids currently revealing (shimmer playing). */
    get revealingIds(): ReadonlySet<string> {
      return revealing;
    },
    isRevealing(id: string): boolean {
      return revealing.has(id);
    },
    /**
     * Feed this the current item list every render (from a `$effect`). It diffs
     * each item's `matchState` against the last one we saw and, for any that just
     * became `matched` from a non-matched state we had already observed, parks the
     * id in the revealing set for `shimmerMs`. Ids that have left the list are
     * forgotten, so a later re-add reads as a first sighting (no false reveal).
     * Returns nothing — it is observed for its effect on the reactive set.
     */
    observe(items: readonly RevealableItem[]): void {
      const reduce = prefersReducedMotion();
      const seen = new Set<string>();
      const fresh: string[] = [];
      for (const item of items) {
        seen.add(item.id);
        const before = prev.get(item.id);
        prev.set(item.id, item.matchState);
        // A genuine "match landed": watched as non-matched, now matched. A first
        // sighting (before === undefined) is never a reveal.
        if (
          !reduce &&
          before !== undefined &&
          before !== 'matched' &&
          item.matchState === 'matched'
        ) {
          fresh.push(item.id);
        }
      }
      // Forget ids no longer present, and drop any stale reveal/timer they held.
      for (const id of [...prev.keys()]) {
        if (!seen.has(id)) {
          prev.delete(id);
          release(id);
        }
      }
      if (fresh.length > 0) {
        revealing = new Set([...revealing, ...fresh]);
        for (const id of fresh) {
          const existing = timers.get(id);
          if (existing !== undefined) clearTimeout(existing);
          timers.set(
            id,
            setTimeout(() => release(id), shimmerMs),
          );
        }
      }
    },
    /** Cancel every pending reveal. Call on teardown so no timer outlives the page. */
    dispose(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      if (revealing.size > 0) revealing = new Set();
    },
  };
}

export type MatchReveal = ReturnType<typeof createMatchReveal>;
