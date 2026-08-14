import type { BatchDoc, BatchStageDoc } from '../schemas/index.js';
import { resolveSchedule } from '../process/index.js';

// The run's state machine (issue #812, phase 1 of epic #778). Pure producers over
// a frozen batch, in the `cookSession` / `process` producer style: take the
// document, return a new one, never mutate.
//
// EVERY ONE IS TOTAL. An unknown stage id is a no-op, a batch that is not running
// is a no-op, and re-marking a stage that is already done is a correction rather
// than an error. A batch is poked at over weeks on a phone in a kitchen; a producer
// that threw on a mis-tap would turn a fat thumb into a crash.
//
// NO CLOCK (CLAUDE.md Rule 1): every instant is injected. `updatedAt` is likewise
// NOT touched here — the write path stamps it on the way to Firestore, the same
// split `guidedPlanService.persist` makes, so there is exactly one place a document
// can disagree with itself about when it was last written.
//
// NOTHING HERE RESCALES. There is no producer that changes a quantity, a total or a
// yield, and there will not be one: freezing is what stops a batch growing versions.
// Re-timing is a different thing entirely — the numbers stand, only the clock moves.

/**
 * The stage the batch is on: the first one not yet marked done.
 *
 * `null` when every stage is finished (the run is over in all but name — see
 * `BatchStateSchema` for why that is derived rather than stored) and `null` for an
 * abandoned batch, which has no next action by definition.
 */
export function currentStage(batch: BatchDoc): BatchStageDoc | null {
  if (batch.state !== 'running') return null;
  return batch.stages.find((stage) => stage.actualEndAt === null) ?? null;
}

/**
 * Mark a stage done at `at`, and RE-TIME EVERYTHING AFTER IT.
 *
 * This is the point of the producer. A prove that ran twenty minutes long does not
 * just record twenty minutes: it moves the shape, the second prove and the bake
 * twenty minutes later, and it does so through the same `resolveSchedule` that
 * placed them in the first place — so a re-timed schedule is indistinguishable from
 * one that was resolved that way to begin with. Early works identically: mark it at
 * 45 minutes and the loaf comes out early, correctly.
 *
 * The stage after this one has, by that same fact, STARTED — its `actualStartAt` is
 * the instant its predecessor ended. That is the only actual this phase infers, and
 * it is not really an inference: it is one boundary with two names.
 *
 * A no-op when the id is unknown, when the batch is not running, or when the
 * instant cannot be read as a time.
 */
export function withStageAdvanced(batch: BatchDoc, stageId: string, at: string): BatchDoc {
  if (batch.state !== 'running') return batch;
  const index = batch.stages.findIndex((stage) => stage.id === stageId);
  if (index === -1) return batch;

  const done: BatchStageDoc = { ...batch.stages[index]!, actualEndAt: at };

  const rest = batch.stages.slice(index + 1);
  const retimed = resolveSchedule(rest, { kind: 'startAt', at });
  // An unreadable instant leaves the batch exactly as it was rather than half-
  // applying the mark: a stage recorded as done against a schedule that still says
  // otherwise is worse than nothing recorded at all.
  if (!retimed.ok) return batch;

  const after: BatchStageDoc[] = retimed.stages.map((stage, i) =>
    // Only the immediate successor starts here. Anything further along is still
    // planned, not observed, and stamping it would claim knowledge of a stage the
    // cook has not reached.
    i === 0 ? { ...stage, actualStartAt: at } : stage,
  );

  return { ...batch, stages: [...batch.stages.slice(0, index), done, ...after] };
}

/**
 * Stop the run.
 *
 * The dough over-proved, the kraut went to mould, the plan changed. Abandoning is a
 * STATE, not a delete: the log of what was mixed and how far it got is exactly what
 * makes batch ten better than batch nine, and Salt has no tombstones because it has
 * no soft-delete — a batch nobody wants to keep is deleted for real, elsewhere.
 *
 * Idempotent, and one-way: nothing here brings a batch back to `running`, because
 * the schedule it was abandoned against is hours or weeks stale and un-abandoning
 * would present those planned times as if they still meant something.
 */
export function withBatchAbandoned(batch: BatchDoc): BatchDoc {
  if (batch.state === 'abandoned') return batch;
  return { ...batch, state: 'abandoned' };
}
