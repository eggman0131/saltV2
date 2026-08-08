import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { CookSessionSchema, type CookActiveTimerDoc } from '@salt/domain/schemas';
import { flushServerObservability } from '@salt/observability/server';
import { reportServerError } from '../observability/reportServerError.js';
import { COOK_TIMER_REGION, type CookTimerTaskPayload } from './cookTimerTypes.js';

export type { CookTimerTaskPayload } from './cookTimerTypes.js';

// Enqueue trigger for cook-timer push notifications (issue #544). On every write
// to a cookSession, diff the armed (notify:true) timers against the prior write
// and enqueue ONE Cloud Task per NEWLY-armed timer, scheduled for its endsAt.
// The dispatch handler (onCookTimerDispatch) sends the push when the task fires.
//
// No secrets here — enqueue touches neither AI nor push. memory/region pinned
// INLINE because this module is evaluated before index.ts's setGlobalOptions
// runs (same reason the other triggers pin them inline).

// A timer's identity for diffing: same timer + same absolute end-time. Extending
// (or shortening) a timer changes endsAt → a NEW key → a NEW task (the old task
// no-ops on dispatch because the matching timer is gone). That is why an adjusted
// duration needs no cancellation path.
function timerKey(t: CookActiveTimerDoc): string {
  return `${t.id}@${t.endsAt}`;
}

export const onCookTimerWrite = onDocumentWritten(
  {
    document: 'cookSessions/{sessionId}',
    region: COOK_TIMER_REGION,
    memory: '512MiB',
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    // Session deleted (cook ended) — nothing to enqueue. Any tasks already queued
    // for its timers no-op on dispatch (the re-read finds no session).
    if (!after?.exists) return;

    const parsed = CookSessionSchema.safeParse(after.data());
    if (!parsed.success) {
      logger.error('onCookTimerWrite: invalid cookSession doc, skipping', {
        sessionId: event.params.sessionId,
        error: parsed.error.message,
      });
      return;
    }

    // Prior timer keys, so a re-write that leaves the timer set unchanged (e.g. a
    // mise-en-place tick) does not re-enqueue. Absent/invalid before → empty set
    // (a create, or a first-ever valid parse), so every current armed timer is new.
    const priorKeys = new Set<string>();
    if (before?.exists) {
      const beforeParsed = CookSessionSchema.safeParse(before.data());
      if (beforeParsed.success) {
        for (const t of beforeParsed.data.activeTimers) priorKeys.add(timerKey(t));
      }
    }

    // Only NEWLY-armed notify timers get a task. A timer present in `before` with
    // the same key is already queued; a notify:false timer never notifies.
    const newTimers = parsed.data.activeTimers.filter(
      (t) => t.notify === true && !priorKeys.has(timerKey(t)),
    );
    if (newTimers.length === 0) return;

    try {
      // The task queue is keyed by the DEPLOYED function name (onCookTimerDispatch),
      // and it MUST be region-qualified. firebase-admin's `taskQueue()` parses a bare
      // name as `{ resourceId }` with NO location and then falls back to its
      // DEFAULT_LOCATION of `us-central1` — it does NOT inherit the calling function's
      // region. Since both this trigger and the dispatch handler are pinned to
      // europe-west2, the bare form built a us-central1 queue URL and every enqueue
      // failed with `functions/not-found: Queue does not exist`, silently killing all
      // cook-timer pushes in every environment. The `locations/{region}/functions/
      // {name}` form is what firebase-admin's parseResourceName accepts.
      const queue = getFunctions().taskQueue<CookTimerTaskPayload>(
        `locations/${COOK_TIMER_REGION}/functions/onCookTimerDispatch`,
      );
      const sessionId = event.params.sessionId;

      for (const t of newTimers) {
        try {
          await queue.enqueue(
            { sessionId, timerId: t.id, endsAt: t.endsAt },
            { scheduleTime: new Date(t.endsAt) },
          );
        } catch (err) {
          // One failed enqueue must not fail the whole trigger (and re-fire it,
          // re-enqueuing the timers that DID succeed → duplicates). Report and
          // move on; the dispatch ledger de-dupes any eventual double anyway.
          logger.error('onCookTimerWrite: enqueue failed', {
            sessionId,
            timerId: t.id,
            endsAt: t.endsAt,
            err,
          });
          reportServerError(err);
        }
      }
    } finally {
      await flushServerObservability();
    }
  },
);
