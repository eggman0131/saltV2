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
export interface CookTimerTaskPayload {
  readonly sessionId: string;
  readonly stepId: string;
  // Absolute ISO end-time; also the task's scheduleTime and part of the ledger id.
  readonly endsAt: string;
}
