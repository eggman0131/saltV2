// Shared Cloud Task payload for the cook-timer push pipeline (issue #544).
// onCookTimerWrite enqueues one of these per newly-armed notify timer; the
// onCookTimerDispatch task handler consumes it. Kept in its own module so both
// the enqueue trigger and the dispatch handler import the SAME type without a
// cross-import between the two trigger files.
//
// IDS ONLY — never recipe/step free-text. The dispatch handler re-reads the live
// session and derives generic copy at send time, so no user content rides on the
// task queue (which is server-owned, but keeping it id-only avoids stale text and
// respects the "no free-form user content in transport" posture).
// The region BOTH cook-timer functions are pinned to. Shared because the enqueue
// side has to name it explicitly (firebase-admin's taskQueue() defaults to
// us-central1 rather than inheriting the caller's region), so the queue's region
// and the dispatch handler's region must never drift apart.
export const COOK_TIMER_REGION = 'europe-west2';

// NOTE: this shape changed with issue #748 — `stepId` became `timerId` (a timer's
// identity is now its own id, and an ad-hoc timer has no step). Tasks queued with
// the OLD shape shortly before that deploy carry no `timerId`, find no matching
// timer and no-op, so their push is silently missed. That is an ACCEPTED gap:
// supporting both shapes would mean dead code in a hot path for a window of
// minutes, for a handful of users, and the in-app chime is unaffected.
export interface CookTimerTaskPayload {
  readonly sessionId: string;
  // The timer's own id — a step timer's id is its step id; an ad-hoc timer's is
  // minted. Part of the ledger id.
  readonly timerId: string;
  // Absolute ISO end-time; also the task's scheduleTime and part of the ledger id.
  readonly endsAt: string;
}
