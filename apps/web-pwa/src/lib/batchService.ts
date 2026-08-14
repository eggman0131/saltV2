import { subscribeBatches, subscribeBatch, saveBatch as saveBatchDoc } from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import type { BatchDoc, Formula, ReferenceYield } from '@salt/domain/schemas';
import type { FreezeBatchFailure, Recipe, ScheduleAnchor } from '@salt/domain';
import {
  flattenIngredients,
  freezeBatch,
  withBatchAbandoned,
  withStageAdvanced,
} from '@salt/domain';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';
import { ErrorCode, failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Batch service (issue #812, phase 1 of epic #778). Stores over the firebase-sync
// subscriptions, and the ONE WRITE PATH for `batches/{batchId}`.
//
// It is also the SOLE ID-MINTER. A run's id is a random UUID and it is minted here,
// exactly once, at the moment the batch is frozen — the same split guidedPlanService
// makes for prep-entry ids and formulaService makes for stage ids. The domain is
// pure and cannot mint one; a screen that minted one could mint two.
//
// Everything that needs a CLOCK lives here too, and nowhere else in the feature.
// `freezeBatch` takes `now` and the anchor; `withStageAdvanced` takes the instant
// the stage finished; `persist` stamps `updatedAt`. The domain never reads a clock
// (CLAUDE.md Rule 1), which is what makes every one of its tests a fixed string.
//
// TWO SUBSCRIPTIONS, because the collection has two consumers with different needs:
// the in-flight surface wants every run at once, and a run's own screen wants one
// document and must survive that document being corrupt (see batchSync.ts). They
// are independent — a page opens whichever it needs and disposes the unsub it got.

// ─── Reactive stores ────────────────────────────────────────────────────────────

// The whole collection. TWO states only (`undefined` = not loaded, then an array):
// an empty list IS the loaded-and-nothing-running state, so there is no third case
// to distinguish.
const _batches = writable<BatchDoc[] | undefined>(undefined);
export const batches: Readable<BatchDoc[] | undefined> = _batches;

// One run. THREE states, the split guidedPlanService and formulaService use:
// `undefined` = not loaded yet, `null` = loaded and there is no such batch (a link
// to a deleted run), a doc = the run.
const _batch = writable<BatchDoc | null | undefined>(undefined);
export const batch: Readable<BatchDoc | null | undefined> = _batch;

/** Synchronous snapshot, for handlers that must read the freshest run. */
export function getBatchSnapshot(): BatchDoc | null | undefined {
  return get(_batch);
}

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Snapshot guards (single-doc store only) ────────────────────────────────────
//
// Newest `updatedAt` we have applied locally for the current run. A batch DOES carry
// `updatedAt` (unlike a formula), so it can take guidedPlanService's stale-echo
// guard as well as the pending-write one: an in-flight snapshot from before a local
// advance must not land afterwards and put the stage back.
let latestLocalEdit: { id: string; updatedAt: string } | null = null;

// Count of our own writes Firestore has not yet acknowledged. An ABSENCE cannot be
// trusted while one is outstanding: it may have been queued before the write reached
// the local cache, and applying it would tell the screen the run does not exist
// moments after it was started. The write supersedes the absence either way (on
// success Firestore re-emits the document; on failure the optimistic copy is kept so
// a dropped connection never silently un-marks a stage), so a swallowed absence is
// dropped rather than replayed.
let pendingWrites = 0;

function applySnapshot(incoming: BatchDoc | null): void {
  if (incoming === null) {
    if (pendingWrites > 0) return; // keep the optimistic copy; see above
    _batch.set(null);
    return;
  }
  const local = latestLocalEdit;
  if (local && local.id === incoming.id && incoming.updatedAt < local.updatedAt) {
    // Stale echo: our local copy is newer — ignore it.
    return;
  }
  latestLocalEdit = { id: incoming.id, updatedAt: incoming.updatedAt };
  _batch.set(incoming);
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

/**
 * Subscribe to every batch — the in-flight surface's store. Returns the unsub.
 *
 * No optimistic guard here: the list is a projection for reading, every write goes
 * through the single-document path, and a list snapshot that briefly lags a local
 * advance shows a stage boundary a second early rather than losing anything.
 */
export function initBatchesSync(): () => void {
  _batches.set(undefined);
  const errors = getErrorReporter();
  return subscribeBatches(
    (incoming) => _batches.set(incoming),
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
  );
}

/**
 * Subscribe to ONE run. Resets the store to the not-loaded state first so moving
 * between runs never shows the previous one.
 */
export function initBatchSync(batchId: string): () => void {
  _batch.set(undefined);
  latestLocalEdit = null;
  return subscribeBatch(
    batchId,
    (incoming) => applySnapshot(incoming),
    (err, rawError) => {
      // Includes the corruption case the adapter reports rather than swallowing.
      // The store is left exactly as it was, so the screen keeps whatever it was
      // showing instead of offering to start the run again.
      reportSubscriptionError(getErrorReporter(), err, rawError);
    },
  );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// Stamp `updatedAt`, update the single-doc store optimistically, then persist the
// whole document. Private: every public command goes through here, which is what
// keeps the timestamp and the optimistic guard in one place.
async function persist(next: BatchDoc): Promise<ReadResult<BatchDoc, DomainError>> {
  const stamped: BatchDoc = { ...next, updatedAt: new Date().toISOString() };
  latestLocalEdit = { id: stamped.id, updatedAt: stamped.updatedAt };
  _batch.set(stamped);
  pendingWrites += 1;
  try {
    const result = reportIfFailed(getErrorReporter(), await saveBatchDoc(stamped));
    if (result.kind !== 'ok') return result;
    return success(stamped);
  } finally {
    pendingWrites -= 1;
  }
}

export interface StartBatchInput {
  recipe: Recipe;
  formula: Formula;
  // What this run makes. Omitted → the formula's own reference yield, i.e. the
  // recipe as written.
  atYield?: ReferenceYield;
  // Mixing now, or out of the oven at 07:30.
  anchor: ScheduleAnchor;
}

// Why a run could not be started, in words. The typed reason stays in the domain
// (`freezeBatch` returns it); what crosses to a screen is a ValidationError with a
// sentence, because every one of these is something the user can act on and none of
// them is worth reporting to PostHog.
function describeFreezeFailure(reason: FreezeBatchFailure): string {
  switch (reason.kind) {
    case 'noProcess':
      return 'This recipe has no stages yet, so there is nothing to schedule. Add its process on the formula screen first.';
    case 'unsolvableFormula':
      return `The formula could not be resolved into weights (${reason.reason.kind}).`;
    case 'unschedulable':
      return 'That time could not be turned into a schedule.';
  }
}

/**
 * Start a run. THE ONLY PLACE A BATCH IS CREATED.
 *
 * Mints the id, joins the recipe's words to the formula's numbers, and hands both
 * to the pure freeze. What lands in Firestore is a snapshot: re-map the formula
 * tomorrow, rename or delete the dish, and this run still says what it was.
 *
 * The labels are the recipe's own `rawText`, keyed by ingredient id — read once,
 * here, so no other caller has to know that the join exists.
 */
export async function startBatch(
  input: StartBatchInput,
): Promise<ReadResult<BatchDoc, DomainError>> {
  const labels: Record<string, string> = {};
  for (const ingredient of flattenIngredients(input.recipe)) {
    labels[ingredient.id] = ingredient.rawText;
  }

  const frozen = freezeBatch({
    id: crypto.randomUUID(),
    formula: input.formula,
    ...(input.atYield === undefined ? {} : { atYield: input.atYield }),
    anchor: input.anchor,
    recipeTitle: input.recipe.title,
    labels,
    // Phase 1 schedules by arithmetic, and arithmetic has no reasoning to record.
    // The proposal flow fills this in phase 2.
    rationale: null,
    now: new Date().toISOString(),
  });
  if (!frozen.ok) {
    return failure({
      kind: 'ValidationError',
      code: ErrorCode.BATCH_NOT_STARTABLE,
      message: describeFreezeFailure(frozen.reason),
    });
  }

  // The new run becomes the single-doc store's value immediately, so the screen
  // that started it can navigate straight to it without waiting for a round trip.
  return persist(frozen.batch);
}

/**
 * Mark a stage done, now.
 *
 * The clock is read HERE and passed in, which is why the re-timing it triggers is a
 * pure function with a fixed answer. Marking a stage done re-times everything after
 * it — see `withStageAdvanced`.
 *
 * A no-op producer (unknown stage, batch not running) still persists, harmlessly:
 * the document written is the one already held, and refusing would mean this
 * service second-guessing a producer that is deliberately total.
 */
export async function advanceStage(
  current: BatchDoc,
  stageId: string,
): Promise<ReadResult<BatchDoc, DomainError>> {
  return persist(withStageAdvanced(current, stageId, new Date().toISOString()));
}

/**
 * Stop a run. A state, not a delete — the log of how far it got is the point.
 */
export async function abandonBatch(current: BatchDoc): Promise<ReadResult<BatchDoc, DomainError>> {
  return persist(withBatchAbandoned(current));
}
