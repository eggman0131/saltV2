import type { KitchenTimersDoc } from '../schemas/index.js';

/**
 * Drop a standalone timer by its id.
 *
 * Cancel and Dismiss are the SAME operation seen from either side of `endsAt`:
 * the entry goes, whether it was still counting or had already fired. There is
 * no tombstone and no `dismissedAt` — CLAUDE.md's no-soft-delete rule applies to
 * an array entry exactly as it does to a document, and a dismissed timer that
 * lingered would have to be filtered out at every read.
 *
 * Immutable, and unconditional: dismissing an id with no live timer yields an
 * equal-but-new document rather than the same reference, which keeps a dismiss
 * idempotent from the cook's point of view.
 */
export function withKitchenTimerDismissed(
  doc: KitchenTimersDoc,
  timerId: string,
): KitchenTimersDoc {
  return { ...doc, timers: doc.timers.filter((t) => t.id !== timerId) };
}
