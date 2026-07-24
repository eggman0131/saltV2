import { prefersReducedMotion } from './reducedMotion.js';

/**
 * Hold-open for the shopping list's check-off celebration (lively list, Phase 1).
 *
 * WRITE NOW, ANIMATE AFTER. The Firestore write fires the instant the circle is
 * tapped; this only holds the row's PLACE in the DOM for as long as the outro
 * runs. Nothing here delays, batches or gates the write. That ordering is the
 * whole point: Firestore writes are optimistic through `persistentLocalCache`, so
 * the store flips and the row would otherwise unmount mid-pop — and a tab close,
 * a navigation or an offline drop part-way through the animation still records
 * the check, because the check was never waiting on the animation.
 *
 * The mechanism is a deliberate INVERSION of the row's own state rather than a
 * filter. `groupItemsByAisle` splits on `item.checked`, so merely hiding a
 * checked row would still let it appear in the Checked bucket, and the count
 * would tick up before the row had finished leaving. `holdInPlace` instead hands
 * the grouping a copy that still reads `checked: false`, so the row keeps
 * rendering exactly where it was; when the hold lapses it lands in Checked and
 * the count ticks up — which is the beat the design asks for.
 *
 * Presentation state only: nothing here is written to Firestore or to any schema
 * (no `isAnimating` field), and it is per-component, not global — a second tab or
 * a second surface has its own.
 *
 * Under reduced motion `begin()` is a no-op, so no row is ever held and the list
 * behaves exactly as it did before this existed. That is the whole fallback: the
 * CSS classes keyed off `isExiting` simply never get applied.
 */

/**
 * How long a checked row is held in place, in ms. Must stay in step with the
 * outro in salt.css: `--duration-linger` (440ms, the tinted beat) plus
 * `--duration-collapse` (320ms, the collapse itself). The row unmounts at the
 * moment it has finished collapsing to nothing, so the swap is invisible.
 */
export const CHECK_OFF_HOLD_MS = 760;

/** All `holdInPlace` needs of an item: identity, and whether it reads as checked. */
export interface HoldableItem {
  readonly id: string;
  readonly checked: boolean;
}

export function createCheckOffHold(holdMs: number = CHECK_OFF_HOLD_MS) {
  // Reassigned, never mutated — the Svelte 5 rune convention used by the page's
  // own `collapsedAisles` / `expandedRows` sets.
  let exiting = $state(new Set<string>());
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function release(ids: readonly string[]): void {
    const next = new Set(exiting);
    let changed = false;
    for (const id of ids) {
      if (next.delete(id)) changed = true;
      const timer = timers.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }
    if (changed) exiting = next;
  }

  return {
    /** Reactive set of ids currently held in place, mid-celebration. */
    get exitingIds(): ReadonlySet<string> {
      return exiting;
    },
    isExiting(id: string): boolean {
      return exiting.has(id);
    },
    /**
     * Feed this between the item list and the grouping. Held items are handed on
     * as `checked: false` copies so they keep rendering in their own group
     * instead of jumping to the Checked bucket; everything else passes through
     * untouched, and the array itself is returned as-is when nothing is held.
     */
    holdInPlace<T extends HoldableItem>(items: readonly T[]): readonly T[] {
      if (exiting.size === 0) return items;
      return items.map((item) =>
        item.checked && exiting.has(item.id) ? ({ ...item, checked: false } as T) : item,
      );
    },
    /**
     * Hold `ids` for the outro. Several ids for a combined row, which animates as
     * the one unit it already renders as. Ids already held are left alone, so a
     * repeat tap neither extends nor duplicates the hold.
     */
    begin(ids: readonly string[]): void {
      if (prefersReducedMotion()) return;
      const fresh = ids.filter((id) => !exiting.has(id));
      if (fresh.length === 0) return;
      exiting = new Set([...exiting, ...fresh]);
      for (const id of fresh) {
        timers.set(
          id,
          setTimeout(() => release([id]), holdMs),
        );
      }
    },
    /** Drop a hold early (e.g. the item was deleted out from under it). */
    release,
    /** Cancel every pending hold. Call on teardown so no timer outlives the page. */
    dispose(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      if (exiting.size > 0) exiting = new Set();
    },
  };
}

export type CheckOffHold = ReturnType<typeof createCheckOffHold>;
