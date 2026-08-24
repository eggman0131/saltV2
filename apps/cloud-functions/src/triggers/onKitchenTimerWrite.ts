import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { KitchenTimersSchema, type KitchenTimerDoc } from '@salt/domain/schemas';
import { reportServerError } from '../observability/reportServerError.js';
import { KITCHEN_TIMER_REGION, type KitchenTimerTaskPayload } from './kitchenTimerTypes.js';
import { withFirestoreTrigger, traceContextFromWrittenDoc } from './triggerEntrypoint.js';

const posthogApiKey = defineSecret('POSTHOG_API_KEY');

export type { KitchenTimerTaskPayload } from './kitchenTimerTypes.js';

// Enqueue trigger for standalone kitchen-timer push notifications (issue #842).
// On every write to `kitchenTimers/{uid}`, diff the armed (notify:true) timers
// against the prior write and enqueue ONE Cloud Task per NEWLY-armed timer,
// scheduled for its `endsAt`. The dispatch handler sends the push when it fires.
//
// A FULL SIBLING of onCookTimerWrite rather than a branch inside it. That one
// re-reads `cookSessions/{sessionId}` and matches inside `activeTimers`; making
// it serve a second collection would mean a document union and a fork at every
// step. The established shape for a second producer is a whole handler of its
// own sharing only the `timerDeliveries` ledger — which is exactly what
// onBatchStageDispatch is, and this is the third.
//
// No secrets here — enqueue touches neither AI nor push. memory/region pinned
// INLINE because this module is evaluated before index.ts's setGlobalOptions
// runs (same reason the other triggers pin them inline).

// A timer's identity for diffing: same timer + same absolute end-time. Re-timing
// (or renaming, which travels in the same whole-document write) changes `endsAt`
// → a NEW key → a NEW task, and the old task no-ops on dispatch because the
// re-read finds no timer at that end-time. That is why there is no cancellation
// path: dismissing a timer removes it from the array, and its queued task simply
// finds nothing to announce.
//
// NOTE what this does NOT key on: the label. A timer renamed but not re-timed
// keeps its key and enqueues nothing new — correct, because the task carries ids
// only and the handler reads the name live at send time.
function timerKey(t: KitchenTimerDoc): string {
  return `${t.id}@${t.endsAt}`;
}

export const onKitchenTimerWrite = onDocumentWritten(
  {
    secrets: [posthogApiKey],
    document: 'kitchenTimers/{uid}',
    region: KITCHEN_TIMER_REGION,
    memory: '512MiB',
  },
  withFirestoreTrigger<{ uid: string }>(async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    // Document deleted — nothing to enqueue. Any tasks already queued for its
    // timers no-op on dispatch (the re-read finds no document).
    if (!after?.exists) return;

    const parsed = KitchenTimersSchema.safeParse(after.data());
    if (!parsed.success) {
      logger.error('onKitchenTimerWrite: invalid kitchenTimers doc, skipping', {
        uid: event.params.uid,
        error: parsed.error.message,
      });
      return;
    }

    // Prior timer keys, so a write that leaves a given timer untouched (dismissing
    // a DIFFERENT one, say, which rewrites the whole document) does not re-enqueue
    // it. Absent/invalid before → empty set, so every current armed timer is new.
    const priorKeys = new Set<string>();
    if (before?.exists) {
      const beforeParsed = KitchenTimersSchema.safeParse(before.data());
      if (beforeParsed.success) {
        for (const t of beforeParsed.data.timers) priorKeys.add(timerKey(t));
      }
    }

    // Only NEWLY-armed notify timers get a task. A timer present in `before` with
    // the same key is already queued; a notify:false timer — one shorter than the
    // delivery-precision floor — never notifies.
    const newTimers = parsed.data.timers.filter(
      (t) => t.notify === true && !priorKeys.has(timerKey(t)),
    );
    if (newTimers.length === 0) return;

    // Region-qualified, and it MUST be: `firebase-admin`'s `taskQueue()` parses
    // a bare name as `{ resourceId }` with NO location and falls back to its
    // DEFAULT_LOCATION of us-central1, which silently killed every cook-timer
    // push until #544's follow-up found it. The
    // `locations/{region}/functions/{name}` form is what parseResourceName takes.
    const queue = getFunctions().taskQueue<KitchenTimerTaskPayload>(
      `locations/${KITCHEN_TIMER_REGION}/functions/onKitchenTimerDispatch`,
    );
    const uid = event.params.uid;

    for (const t of newTimers) {
      try {
        await queue.enqueue(
          { uid, timerId: t.id, endsAt: t.endsAt },
          { scheduleTime: new Date(t.endsAt) },
        );
      } catch (err) {
        // One failed enqueue must not fail the whole trigger (and re-fire it,
        // re-enqueuing the timers that DID succeed → duplicates). Report and
        // move on; the dispatch ledger de-dupes any eventual double anyway.
        logger.error('onKitchenTimerWrite: enqueue failed', {
          uid,
          timerId: t.id,
          endsAt: t.endsAt,
          err,
        });
        reportServerError(err);
      }
    }
  }, traceContextFromWrittenDoc),
);
