import {
  subscribeGuidedPlan,
  saveGuidedPlan as saveGuidedPlanDoc,
  callGenerateGuidedPlan,
} from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import type { GuidedPlanDoc, GuidedPrepEntryDoc } from '@salt/domain/schemas';
import type { Recipe } from '@salt/domain';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';
import { success, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Guided-plan service (issue #751, Phase 1). An optimistic store over the
// firebase-sync single-doc subscription, and the ONE write path for the document.
//
// Everything that decides a control field lives here, not in the flow and not in
// the page: `needs_approval` (set by a generation, dropped by a save),
// `recipeUpdatedAtAtSave` (re-stamped by BOTH), `createdAt`/`updatedAt`, and the
// prep-entry ids. The CF authors prose; this file owns the document.
//
// The plan editor owns the subscription lifecycle: it calls initGuidedPlanSync
// with the recipe id and disposes the returned unsub on teardown.

// ─── Reactive store ─────────────────────────────────────────────────────────────

// THREE STATES, the same split shoppingDayService's `upcomingShopDay` documents:
// `undefined` = not loaded yet, `null` = loaded and there is no plan, a doc = the
// plan. Load-bearing here: the editor's whole empty state is a "Write the plan"
// prompt, and without a distinct not-loaded state that prompt flashes on every
// visit to a recipe that HAS a plan, one frame before the plan arrives.
const _plan = writable<GuidedPlanDoc | null | undefined>(undefined);
export const guidedPlan: Readable<GuidedPlanDoc | null | undefined> = _plan;

/** Synchronous snapshot, for handlers that must read the freshest plan. */
export function getGuidedPlanSnapshot(): GuidedPlanDoc | null | undefined {
  return get(_plan);
}

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Snapshot guard ─────────────────────────────────────────────────────────────
// Newest `updatedAt` we have applied locally for the current plan (from an
// optimistic write or an accepted snapshot). Guards against an in-flight stale
// snapshot echo landing after a newer local edit and reverting it.
let latestLocalEdit: { id: string; updatedAt: string } | null = null;

// Count of our own writes Firestore has not yet acknowledged. An ABSENCE cannot be
// trusted while one is outstanding: it may have been queued before the write
// reached the local cache, and applying it would blank a plan that exists — which
// in this editor means replacing the user's work with a "Write the plan" button.
// The write supersedes the absence either way (on success Firestore re-emits the
// document; on failure the optimistic copy is deliberately kept so a transient
// error never costs the user their edits), so a swallowed absence is dropped
// rather than replayed.
let pendingWrites = 0;

function applySnapshot(incoming: GuidedPlanDoc | null): void {
  if (incoming === null) {
    if (pendingWrites > 0) return; // keep the optimistic copy; see above
    _plan.set(null);
    return;
  }
  const local = latestLocalEdit;
  if (local && local.id === incoming.id && incoming.updatedAt < local.updatedAt) {
    // Stale echo: our local copy is newer — ignore it.
    return;
  }
  latestLocalEdit = { id: incoming.id, updatedAt: incoming.updatedAt };
  _plan.set(incoming);
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

/**
 * Subscribe to one recipe's guided plan. Resets the store to the not-loaded state
 * first so moving between recipes never shows the previous recipe's plan.
 */
export function initGuidedPlanSync(recipeId: string): () => void {
  _plan.set(undefined);
  latestLocalEdit = null;
  const errors = getErrorReporter();
  return subscribeGuidedPlan(
    recipeId,
    (incoming) => applySnapshot(incoming),
    (err, rawError) => {
      // Includes the corruption case the adapter reports rather than swallowing.
      // The store is left exactly as it was: on a first load that means the editor
      // stays on its loading state rather than offering to overwrite a document it
      // could not read.
      reportSubscriptionError(errors, err, rawError);
    },
  );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// Stamp `updatedAt`, update the store optimistically, then persist the whole doc.
// Private: every public command below goes through here, which is what keeps the
// optimistic guard and the timestamp in one place.
async function persist(plan: GuidedPlanDoc): Promise<ReadResult<GuidedPlanDoc, DomainError>> {
  const stamped: GuidedPlanDoc = { ...plan, updatedAt: new Date().toISOString() };
  latestLocalEdit = { id: stamped.id, updatedAt: stamped.updatedAt };
  _plan.set(stamped);
  pendingWrites += 1;
  try {
    const result = reportIfFailed(getErrorReporter(), await saveGuidedPlanDoc(stamped));
    if (result.kind !== 'ok') return result;
    return success(stamped);
  } finally {
    pendingWrites -= 1;
  }
}

/**
 * Write (or re-write) the plan for a recipe from the AI.
 *
 * A re-run REPLACES the previous plan outright — whole-document LWW, no merge:
 * "get a fresh one" is the whole point of the button, and half-merging a new prep
 * list into hand-corrected text would produce a document neither the model nor the
 * human wrote. `createdAt` is carried over from an existing plan (the plan for this
 * recipe has existed since then), everything else is fresh.
 *
 * Flagged `needs_approval` because nobody has read it yet. That is the ONLY place
 * the flag is ever set — a plan authored entirely by hand is never flagged.
 */
export async function generateGuidedPlan(
  recipe: Recipe,
): Promise<ReadResult<GuidedPlanDoc, DomainError>> {
  const authored = await callGenerateGuidedPlan({ recipeId: recipe.id });
  if (authored.kind !== 'ok') return reportIfFailed(getErrorReporter(), authored);

  const now = new Date().toISOString();
  const existing = get(_plan);
  return persist({
    id: recipe.id,
    schemaVersion: 1,
    recipeId: recipe.id,
    // Stamped against the recipe the FLOW read, which is the recipe in Firestore.
    recipeUpdatedAtAtSave: recipe.updatedAt,
    needs_approval: true,
    // Ids are minted here, not by the model: they are document-local identity, and
    // the editor needs them the moment the list renders (they key the rows).
    prep: authored.value.prep.map((entry): GuidedPrepEntryDoc => ({
      ...entry,
      id: crypto.randomUUID(),
    })),
    stepNotes: authored.value.stepNotes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Save a human's edits. THE SAVE IS THE REVIEW, and it does two things beyond
 * writing the text:
 *
 *  1. Drops `needs_approval` — dropped, never written `false`; absent means
 *     reviewed (the same contract, and the same idiom, as the recipe page's
 *     "Mark reviewed").
 *  2. Re-stamps `recipeUpdatedAtAtSave` to the recipe as it stands NOW. A save is
 *     a review of the plan against the current recipe, so reconciling a plan by
 *     hand after the recipe changed clears the stale banner. Without this the only
 *     way out of that banner would be a re-run, which destroys every corrected line.
 */
export async function saveGuidedPlan(
  plan: GuidedPlanDoc,
  recipe: Recipe,
): Promise<ReadResult<GuidedPlanDoc, DomainError>> {
  const { needs_approval: _wasUnreviewed, ...reviewed } = plan;
  return persist({ ...reviewed, recipeUpdatedAtAtSave: recipe.updatedAt });
}
