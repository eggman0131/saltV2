import type { CanonItem, PendingCanonChange } from '../entities/CanonItem.js';

/**
 * Append one pending change to a canon item (issue #193).
 *
 * Pure and additive: entries accumulate in the order they happened (most recent
 * last) and carry no timestamp — the doc's own `updatedAt` records when, array
 * order records the sequence.
 *
 * The set-sites call this rather than each spreading the array by hand. It does
 * NOT set `needs_approval`: recording and flagging are separate decisions, and
 * the caller already owns the flag.
 *
 * CAUTION: only call this when a change genuinely happened. `appendCanonSynonym`
 * returns its input BY REFERENCE on a no-op and matchOrCreate's `updated !== item`
 * guard keys off that identity to decide whether to write.
 */
export function recordPendingCanonChange(item: CanonItem, change: PendingCanonChange): CanonItem {
  return { ...item, pendingChanges: [...(item.pendingChanges ?? []), change] };
}
