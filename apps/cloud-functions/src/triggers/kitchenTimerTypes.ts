// Shared Cloud Task payload for the standalone kitchen-timer push pipeline
// (issue #842). onKitchenTimerWrite enqueues one of these per newly-armed notify
// timer; the onKitchenTimerDispatch task handler consumes it. Kept in its own
// module so both the enqueue trigger and the dispatch handler import the SAME
// type without a cross-import between the two trigger files — the arrangement
// `cookTimerTypes.ts` already established.
//
// IDS ONLY — never the timer's label. The dispatch handler re-reads the live
// document and takes the name from there at send time, so no user content rides
// on the task queue. That also means a timer renamed after it was armed is
// announced by its NEW name, which is the one the chef will be looking for.

// The region BOTH kitchen-timer functions are pinned to. Shared for the reason
// the cook timer's is: `firebase-admin`'s `taskQueue()` defaults to us-central1
// rather than inheriting the calling function's region, so the enqueue side has
// to name the region explicitly and the two must never drift apart.
export const KITCHEN_TIMER_REGION = 'europe-west2';

export interface KitchenTimerTaskPayload {
  // Whose kitchen. This is BOTH the `kitchenTimers` document id and the value the
  // handler filters `pushSubscriptions` on, so the send target is proven by the
  // same document that armed the timer.
  readonly uid: string;
  // The timer's own id, minted client-side. Only unique WITHIN a user, which is
  // why the uid is part of the ledger key as well.
  readonly timerId: string;
  // Absolute ISO end-time; also the task's scheduleTime and part of the ledger id.
  readonly endsAt: string;
}
