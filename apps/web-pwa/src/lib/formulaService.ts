import { subscribeFormula, saveFormula as saveFormulaDoc } from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import type { Formula } from '@salt/domain/schemas';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';
import { success, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Formula service (issue #806, phase 1 of epic #778). A store over the
// firebase-sync single-doc subscription, and the ONE write path for
// `formulas/{recipeId}`.
//
// Modelled on guidedPlanService, with one deliberate omission: there is no
// stale-echo guard, because the formula document carries NO timestamps. It has no
// `updatedAt` to order two snapshots by, and inventing one purely to power a guard
// would put a field on a production-bound schema to serve a client concern.
// Document-level LWW is the whole conflict story — the same answer
// `mealPlans/{startDate}` gives.
//
// The `pendingWrites` counter DOES carry over, because it guards against
// something LWW does not cover: an absence snapshot queued before our own write
// reached the local cache. Applying it would tell the screen there is no formula
// moments after one was saved, and the screen would re-derive a fresh guess over
// the top of it.
//
// The formula screen owns the subscription lifecycle: it calls initFormulaSync
// with the recipe id and disposes the returned unsub on teardown.

// ─── Reactive store ─────────────────────────────────────────────────────────────

// THREE STATES, the same split guidedPlanService and shoppingDayService use:
// `undefined` = not loaded yet, `null` = loaded and there is no formula, a doc =
// the formula. Load-bearing here: on a first visit the screen DERIVES a formula
// from the recipe, and without a distinct not-loaded state that derivation would
// run — and be shown — one frame before a stored formula arrived to replace it.
const _formula = writable<Formula | null | undefined>(undefined);
export const formula: Readable<Formula | null | undefined> = _formula;

/** Synchronous snapshot, for handlers that must read the freshest formula. */
export function getFormulaSnapshot(): Formula | null | undefined {
  return get(_formula);
}

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Snapshot guard ─────────────────────────────────────────────────────────────

// Count of our own writes Firestore has not yet acknowledged. See the header: an
// ABSENCE cannot be trusted while one is outstanding. The write supersedes the
// absence either way (on success Firestore re-emits the document; on failure the
// optimistic copy is deliberately kept so a transient error never costs the user
// their mapping), so a swallowed absence is dropped rather than replayed.
let pendingWrites = 0;

function applySnapshot(incoming: Formula | null): void {
  if (incoming === null && pendingWrites > 0) return; // keep the optimistic copy
  _formula.set(incoming);
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

/**
 * Subscribe to one recipe's formula. Resets the store to the not-loaded state
 * first so moving between recipes never shows the previous recipe's formula.
 */
export function initFormulaSync(recipeId: string): () => void {
  _formula.set(undefined);
  const errors = getErrorReporter();
  return subscribeFormula(
    recipeId,
    (incoming) => applySnapshot(incoming),
    (err, rawError) => {
      // Includes the corruption case the adapter reports rather than swallowing.
      // The store is left exactly as it was: on a first load that means the screen
      // stays on its loading state rather than offering to map a recipe whose
      // stored formula it could not read.
      reportSubscriptionError(errors, err, rawError);
    },
  );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Save a formula. THE ONLY WRITE PATH for `formulas/{recipeId}`.
 *
 * Optimistic: the store takes the new formula before the round trip, and keeps it
 * if the write fails, so a dropped connection never silently reverts the mapping
 * on screen. Whole-document LWW — a re-map replaces, it does not merge.
 */
export async function saveFormula(next: Formula): Promise<ReadResult<Formula, DomainError>> {
  _formula.set(next);
  pendingWrites += 1;
  try {
    const result = reportIfFailed(getErrorReporter(), await saveFormulaDoc(next));
    if (result.kind !== 'ok') return result;
    return success(next);
  } finally {
    pendingWrites -= 1;
  }
}
