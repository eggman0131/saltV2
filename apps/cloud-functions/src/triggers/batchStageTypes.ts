// Shared Cloud Task payload for the batch stage-reminder pipeline (issue #812,
// phase 3 of epic #778). `onBatchWritten` enqueues one of these per remindable
// stage; `onBatchStageDispatch` consumes it. Kept in its own module so both sides
// import the SAME type without a cross-import between the two trigger files —
// exactly the shape `cookTimerTypes.ts` set for the cook timer.
//
// IDS ONLY — never a recipe title or a stage label. The dispatch handler re-reads
// the live batch and derives its copy at send time, so no user content rides on the
// task queue and no notification can announce a label that was edited hours ago.

// The region BOTH batch-reminder functions are pinned to, DECLARED HERE rather than
// imported from the cook timer: the two pipelines are structural mirrors, not one
// pipeline with two front ends, and sharing the constant would silently couple the
// batch queue's location to a decision that belongs to #544.
//
// It is pinned inline, in this module, for the same reason the cook timer's is:
// these trigger modules are evaluated BEFORE index.ts's `setGlobalOptions` runs, so
// a region read from global options would not be set yet.
//
// It must also be stated at all, and it must reach `taskQueue()` in the
// `locations/{region}/functions/{name}` form. firebase-admin parses a BARE function
// name as `{ resourceId }` with no location and falls back to its DEFAULT_LOCATION
// of `us-central1` — it does NOT inherit the calling function's region. That exact
// mistake built a us-central1 queue URL for the cook timer and killed every push in
// every environment with a `functions/not-found`. Do not shorten the queue name.
export const BATCH_STAGE_REGION = 'europe-west2';

// ─── The Cloud Tasks scheduling horizon ─────────────────────────────────────────
//
// Google Cloud Tasks refuses a `scheduleTime` more than 30 DAYS ahead. Bread's 18
// hours is nowhere near it, so nothing in this phase can hit it — but
// docs/formulas-schedules-batches.md lists it as an open question ("a 90-day dry may
// exceed the maximum schedule-ahead time... cheap to check now, painful at phase
// 04"), and the cheap check is this constant plus the guard in `onBatchWritten`.
//
// A stage past the horizon is SKIPPED AND LOGGED, never enqueued: an enqueue that
// far out fails at the API, and failing loudly for a cure in phase 04 is far better
// than a silent gap nobody notices for three months. Phase 04 owns the real answer
// (a re-enqueue chain, or a scheduled sweep that tops the queue up) — this is the
// guard it will find waiting rather than the surprise it would otherwise meet.
export const CLOUD_TASKS_HORIZON_DAYS = 30;
export const CLOUD_TASKS_HORIZON_MS = CLOUD_TASKS_HORIZON_DAYS * 24 * 60 * 60 * 1000;

export interface BatchStageTaskPayload {
  readonly batchId: string;
  // The stage's document-local id, minted by the write path. Part of the ledger id.
  readonly stageId: string;
  // The stage's PLANNED start, ISO-8601. It is the task's scheduleTime, it is part
  // of the ledger id, and it is the staleness check: marking a stage done re-times
  // everything after it, which changes this string, which makes the already-queued
  // task match nothing and no-op. That is the whole cancellation-free design — no
  // task is ever deleted, because a stale one costs a single Firestore read.
  readonly plannedStartAt: string;
  // The notification audience, FROZEN AT ENQUEUE TIME (issue #831): the uids that
  // passed the `bread` feature flag when the reminder was scheduled. It rides HERE,
  // on the task, and never as a field on the batch document — the client rewrites
  // that document wholesale with `setDoc`, so an audience stored on it would be
  // clobbered under LWW by the very stage advance that scheduled the reminder.
  //
  // Freezing it also keeps PostHog off the critical path of a time-sensitive
  // reminder: dispatch reads this list, it never asks. A PostHog outage at 06:45
  // cannot cost the preheat.
  //
  // Uids are IDS, so this respects the module rule above — no recipe title, no stage
  // label, nothing that could announce copy edited hours ago.
  //
  // OPTIONAL ON PURPOSE, and this is the whole back-compat story. ABSENT means
  // BROADCAST — a task enqueued before this change carries no field, and dispatch
  // must read that absence as today's behaviour rather than as "nobody", or every
  // already-queued reminder goes silent. An EMPTY ARRAY means the opposite and must
  // be honoured: nobody passed the flag, so nobody is woken. That distinction is the
  // one thing a reader will get wrong.
  readonly notifyUids?: readonly string[];
}
