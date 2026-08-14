import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { BatchSchema, type BatchStageDoc } from '@salt/domain/schemas';
import { remindableStages } from '@salt/domain';
import { flushServerObservability } from '@salt/observability/server';
import { reportServerError } from '../observability/reportServerError.js';
import {
  BATCH_STAGE_REGION,
  CLOUD_TASKS_HORIZON_DAYS,
  CLOUD_TASKS_HORIZON_MS,
  type BatchStageTaskPayload,
} from './batchStageTypes.js';

export type { BatchStageTaskPayload } from './batchStageTypes.js';

// Enqueue trigger for batch stage reminders (issue #812, phase 3 of epic #778). On
// every write to a batch, work out which stages earn a notification, diff them
// against the prior write, and enqueue ONE Cloud Task per newly-scheduled reminder.
// `onBatchStageDispatch` sends the push when the task fires.
//
// The rule about WHICH stages is `remindableStages`, in the domain, where it can be
// reasoned about without a clock: the first stage, and any stage that follows a
// `wait`. On the overnight loaf that is mix, shape, preheat and bake — and nothing
// at all across the eight hours in the fridge, which is the point.
//
// CANCELLATION-FREE, exactly as the cook timer is. Nothing here ever deletes a
// Cloud Task. Marking a stage done re-times every stage after it, which changes
// their `plannedStartAt`, which changes the diff key AND the task payload — so a
// fresh task is enqueued and the stale one no-ops on dispatch by re-reading the
// live batch. A cancellation path would buy nothing but a second thing to get wrong.
//
// No secrets here — enqueue touches neither AI nor push. memory/region pinned
// INLINE because this module is evaluated before index.ts's setGlobalOptions runs
// (same reason the other triggers pin them inline).

// A reminder's identity for diffing: same stage + same planned start. A re-timed
// stage is a NEW key and therefore a NEW task; an untouched one is not re-enqueued,
// which matters because a batch is written on every stage advance and would
// otherwise re-queue every remaining reminder each time.
function reminderKey(stage: BatchStageDoc): string {
  return `${stage.id}@${stage.plannedStartAt}`;
}

export const onBatchWritten = onDocumentWritten(
  {
    document: 'batches/{batchId}',
    region: BATCH_STAGE_REGION,
    memory: '512MiB',
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    const batchId = event.params.batchId;

    // Batch deleted — nothing to enqueue. Tasks already queued for it no-op on
    // dispatch (the re-read finds no document).
    if (!after?.exists) return;

    const parsed = BatchSchema.safeParse(after.data());
    if (!parsed.success) {
      // A trigger has no caller to surface a Failure to: log and return.
      logger.error('onBatchWritten: invalid batch doc, skipping', {
        batchId,
        error: parsed.error.message,
      });
      return;
    }
    const batch = parsed.data;

    // An abandoned run has no next action by definition, so it earns no reminders.
    // Its outstanding tasks are left to no-op rather than chased down.
    if (batch.state !== 'running') return;

    // Prior reminder keys, so an ordinary write that moved nothing — a rename, a
    // rationale, an `updatedAt` bump — does not re-enqueue. Absent/invalid before →
    // empty set (a create, or a first valid parse), so every reminder is new.
    const priorKeys = new Set<string>();
    if (before?.exists) {
      const beforeParsed = BatchSchema.safeParse(before.data());
      if (beforeParsed.success) {
        for (const stage of beforeParsed.data.stages) priorKeys.add(reminderKey(stage));
      }
    }

    // The one clock reading in the whole enqueue, and it is here rather than in the
    // domain rule for exactly that reason (CLAUDE.md Rule 1).
    const nowMs = Date.now();
    const horizonMs = nowMs + CLOUD_TASKS_HORIZON_MS;

    const due = remindableStages(batch.stages).filter((stage) => {
      if (priorKeys.has(reminderKey(stage))) return false;

      // A stage that has already begun or already finished needs no reminder to
      // begin. This is what keeps the immediate successor of a just-advanced stage
      // quiet: `withStageAdvanced` stamps its `actualStartAt` at the same instant it
      // re-times it, so the cook who has just tapped "done" is not pinged to start
      // the thing they are already standing over.
      if (stage.actualStartAt !== null || stage.actualEndAt !== null) return false;

      const atMs = Date.parse(stage.plannedStartAt);
      if (!Number.isFinite(atMs)) {
        logger.error('onBatchWritten: unreadable plannedStartAt, skipping stage', {
          batchId,
          stageId: stage.id,
          plannedStartAt: stage.plannedStartAt,
        });
        return false;
      }

      // ALREADY PAST. Cloud Tasks dispatches a past `scheduleTime` immediately, and
      // a reminder that arrives for a moment already gone is not a reminder. The
      // common case is a batch anchored "I am mixing NOW": the first stage's planned
      // start is the instant the button was tapped, and pinging someone to start
      // what they are visibly already doing is noise. The valuable half of the
      // first-stage rule is untouched — a schedule back-solved from "out of the oven
      // at 07:30" puts the mix hours in the future, which is precisely when nothing
      // else in the app would have told them.
      if (atMs <= nowMs) return false;

      // Beyond the Cloud Tasks 30-day horizon — see CLOUD_TASKS_HORIZON_MS. Skip it
      // LOUDLY and carry on with the rest: one unschedulable stage of a long cure
      // must not cost the reminders that ARE within reach. Nothing in this phase can
      // reach here (bread is eighteen hours); phase 04 will.
      if (atMs > horizonMs) {
        logger.warn('onBatchWritten: stage is beyond the Cloud Tasks horizon, not enqueued', {
          batchId,
          stageId: stage.id,
          plannedStartAt: stage.plannedStartAt,
          horizonDays: CLOUD_TASKS_HORIZON_DAYS,
        });
        return false;
      }

      return true;
    });

    if (due.length === 0) return;

    try {
      // Region-qualified, never the bare name — see BATCH_STAGE_REGION for the
      // us-central1 fallback this avoids and the outage it caused once already.
      const queue = getFunctions().taskQueue<BatchStageTaskPayload>(
        `locations/${BATCH_STAGE_REGION}/functions/onBatchStageDispatch`,
      );

      for (const stage of due) {
        try {
          await queue.enqueue(
            { batchId, stageId: stage.id, plannedStartAt: stage.plannedStartAt },
            { scheduleTime: new Date(stage.plannedStartAt) },
          );
        } catch (err) {
          // One failed enqueue must not fail the whole trigger (and re-fire it,
          // re-enqueuing the stages that DID succeed → duplicates). Report and move
          // on; the dispatch ledger de-dupes any eventual double anyway.
          logger.error('onBatchWritten: enqueue failed', {
            batchId,
            stageId: stage.id,
            plannedStartAt: stage.plannedStartAt,
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
