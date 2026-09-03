import { diffRecipe, reconcileRecipePhases, type Recipe } from '@salt/domain';
import type { RecipeDiff } from '@salt/domain';
import type { AuthorRecipeInput, RecipeDoc } from '@salt/domain/schemas';
import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
import { success, type DomainError, type ReadResult } from '@salt/shared-types';
import { authorRecipeTraced, stampRecipeAttribution } from './recipeService.js';
import { discardGuidedPlan } from './guidedPlanService.js';

// Amending a recipe by chat — propose, merge, diff, apply (issue #764).
//
// This is the ONE implementation of the review gate. It was two: the recipe
// page's sidebar/drawer and the full `/chat/:id` page each had their own copy,
// and they drifted — the older copy preserved metadata the librarian omitted,
// the newer one spread the draft straight through and so proposed to erase the
// user's servings, times and tags. Both surfaces now call in here, so the saved
// document cannot depend on which door you came through. A page owns its own
// busy/open state, its toasts and where it navigates afterwards; it owns nothing
// about what gets written.
//
// Refresh (⋮ → Refresh) is a third caller and needs nothing of its own here
// (issue #890): it sends the chef a canned turn asking for the dish to be
// written out again, and what comes back is an ordinary conversation. It reviews
// and applies through `proposeRecipeAmendment` like any other amendment, which
// is the point — a re-authored recipe and a hand-typed edit reach the document
// by exactly one path.

export interface RecipeAmendment {
  /** The merged recipe, ready to save. Nothing is written until `applyRecipeAmendment`. */
  updated: Recipe;
  /** What changed, for the review summary. Diffed POST-merge, so preserved fields show no row. */
  diff: RecipeDiff;
  /**
   * The recipe this was authored from. Carried on the proposal rather than
   * asked of the caller (issue #918) so that applying cannot be done without
   * the one fact that decides whether the guided plan survives the write — see
   * `applyRecipeAmendment`. A surface that holds a proposal necessarily holds
   * what it was proposed against, so nothing is asked of the page that it did
   * not already have.
   */
  existing: Recipe;
}

/**
 * Merge a librarian draft onto the recipe it was authored from.
 *
 * **A null metadata field means "the model forgot", not "the user wants this
 * cleared" — so the existing value is preserved.** The librarian is instructed
 * to return the complete recipe with only the discussed changes applied, and it
 * mostly does; when it drops `servings` or a time it was never asked about, that
 * is a lapse rather than an instruction. The asymmetry decides it: a wrongly
 * PRESERVED value shows no diff row and is harmless, because the value was
 * already correct — a wrongly CLEARED one forces the reviewer to discard the
 * whole proposal, good changes and all, and reads as though the chef decided to
 * delete their timings.
 *
 * The deliberate cost, which is intended behaviour and not a second bug:
 * **clearing a metadata field is an editor job.** You cannot empty servings, a
 * time, or the last remaining tag through chat. An empty tag list from the
 * librarian is read the same way as a null number — the model returned nothing,
 * so the recipe keeps what it had.
 *
 * Everything else in the draft is authoritative: title, description, notes,
 * ingredients and steps are what the conversation was about, and an empty one of
 * those is a real edit. `kind`, `producesCanonId` and `createdBy` need no
 * handling here — the CF already carries them across from the base recipe in
 * edit mode (`assembleRecipeDraft`), and `kind` is immutable anyway.
 * `lastEditedBy` is deliberately NOT stamped here either: this function is pure
 * and knows no user, and the amender is stamped at `applyRecipeAmendment` so the
 * name lands on the write rather than on a proposal that may be discarded.
 *
 * Pure: same inputs, same output, no clock and no I/O — `updatedAt` is supplied
 * by the caller so this stays directly testable.
 */
export function mergeAmendedRecipe(existing: Recipe, draft: RecipeDoc, updatedAt: string): Recipe {
  // The phase strip and the sentence written over it (issue #1122) are ONE fact,
  // so they are decided by the one shared pairing rule — the same call
  // `assembleRecipeDraft` and `onRecipeWritten`'s re-estimate branch make — and
  // never by two independent `?? existing` fallbacks like the scalars below
  // (issue #1203). Merged field by field they came apart exactly where it
  // mattered: `draft.metadata.phases` is always a defined array, so the fresh
  // strip always won, while a `timingSummary` the librarian was never asked about
  // came back `null` and silently restored the stored recipe's OLD sentence
  // underneath it — a one-block traybake described as taking 2¼ hours.
  //
  // `reconcileRecipePhases` keeps the no-loss floor the scalars have: a draft
  // carrying no strip at all falls back to the stored pair WHOLE. That IS the
  // boundary of the claim, and on today's amend path it does not clear it —
  // the librarian is always instructed to return 3–6 phases (`PHASE_RULES`,
  // `recipeFieldRules.ts`) and is never shown the stored strip to preserve
  // (`formatRecipeForPrompt`, `recipeText.ts`, not extended for #1122's two
  // fields), so `draft.metadata.phases` on an unrelated chat turn is a freshly
  // invented strip, not an absent one, and the "answered" branch takes it every
  // time. The floor is real for a caller whose draft omits phases; a chat
  // amend is not yet that caller, so a hand-corrected strip is NOT yet
  // protected from being overwritten by an unrelated turn. Closing that gap is
  // teaching the prompt to show the stored strip, which is out of scope here
  // (issue #1202 Phase 2 / #1203 Must-not-touch: the flows and prompts).
  const phaseStrip = reconcileRecipePhases(draft.metadata, existing.metadata);

  return {
    ...draft,
    // Identity stays the existing recipe's: this is an edit, not a new dish.
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt,
    // The librarian never returns either (always null / `{ type: 'manual' }`),
    // so carry them over or an amend would drop the hero image and provenance.
    image: existing.image,
    source: existing.source,
    metadata: {
      servings: draft.metadata.servings ?? existing.metadata.servings,
      totalTimeMinutes: draft.metadata.totalTimeMinutes ?? existing.metadata.totalTimeMinutes,
      prepTimeMinutes: draft.metadata.prepTimeMinutes ?? existing.metadata.prepTimeMinutes,
      cookTimeMinutes: draft.metadata.cookTimeMinutes ?? existing.metadata.cookTimeMinutes,
      // The phase strip and its summary (issue #1122), paired above rather than
      // merged here. This merge builds `metadata` field by field rather than
      // spreading, so a key omitted here is a key silently DELETED from the
      // document on every amend — which is what would have quietly thrown away a
      // strip a cook had corrected. Both keys are written on every amend, as `[]`
      // and `null` when neither side has a strip: that is what "no strip" is
      // stored as everywhere else, and Firestore has no `undefined` to write.
      phases: phaseStrip.phases,
      timingSummary: phaseStrip.timingSummary,
      tags: draft.metadata.tags.length > 0 ? draft.metadata.tags : existing.metadata.tags,
    },
  };
}

/**
 * Re-run the librarian over the conversation and return a PENDING proposal.
 * Writes nothing — the review gate's whole point is that the user sees the diff
 * first. The diff is taken after the merge, so preserved metadata doesn't
 * surface as a spurious "changed to null".
 */
export async function proposeRecipeAmendment(
  existing: Recipe,
  messages: AuthorRecipeInput['messages'],
  existingTags: string[],
): Promise<ReadResult<RecipeAmendment, DomainError>> {
  return propose(existing, { messages, existingTags, recipeId: existing.id });
}

/**
 * The shared half: call the librarian, merge its draft onto the recipe, diff
 * post-merge. Every propose in this module goes through here — which is the
 * whole reason #764 collapsed two copies into one.
 */
async function propose(
  existing: Recipe,
  input: AuthorRecipeInput,
): Promise<ReadResult<RecipeAmendment, DomainError>> {
  const result = await authorRecipeTraced(input, existing.title);
  if (result.kind !== 'ok') return result;

  const updated = mergeAmendedRecipe(existing, result.value, new Date().toISOString());
  return success({ existing, updated, diff: diffRecipe(existing, updated) });
}

/**
 * Commit a proposal — the gate's confirm. It keeps the save on the same seam as
 * the propose, so the two surfaces cannot acquire different ideas about what
 * applying means the way they did about merging.
 *
 * It adds attribution (issue #845): confirming a proposal IS the human edit, so
 * the amender is stamped here — on the write, not on a proposal that may be
 * discarded. `createdBy` is untouched by that stamp when it already holds a
 * name, so amending someone else's recipe by chat credits you as the editor and
 * leaves them as the one who added it.
 *
 * And it decides the guided plan (issue #918). That check used to live in the
 * recipe page's apply handler and nowhere else, so the SAME amendment applied
 * from `/chat/:id` left the plan behind — one rule with two implementations,
 * only one of which knew the rule, which is the #764 shape exactly. It lives
 * here now because here is the one door both surfaces come through.
 *
 * Whether the plan survives is decided by the one fact that actually governs it:
 * are the step ids its `stepNotes` point at still there? This used to ask a
 * different question — did the proposal come from Refresh rather than from the
 * chat (issue #784) — on the belief that a chat amendment preserved the ids of
 * steps it did not change. It does not: `assembleRecipeDraft` mints a fresh
 * `crypto.randomUUID()` for EVERY step on every amend, ingredients being the
 * only things reused by content. So a chat amendment left the plan pointing at
 * steps that no longer existed, silently, and the stale-recipe banner cannot
 * help with references that do not resolve. Asking about the ids covers every
 * door and cannot drift when a new one opens (issue #890).
 */
export async function applyRecipeAmendment(
  amendment: RecipeAmendment,
): Promise<ReadResult<void, DomainError>> {
  const survivingStepIds = new Set(amendment.updated.steps.map((step) => step.id));
  const planStepsInvalidated = amendment.existing.steps.some(
    (step) => !survivingStepIds.has(step.id),
  );

  const saveResult = await saveRecipeDoc(stampRecipeAttribution(amendment.updated));

  // Only after the save succeeds — throwing away the plan for a write that never
  // landed would be a plain loss. Best-effort: a failed delete leaves a stale
  // plan, which is the situation we were already in, so it must not turn a
  // successful save into an error the user has to interpret.
  if (saveResult.kind === 'ok' && planStepsInvalidated) {
    await discardGuidedPlan(amendment.updated.id);
  }

  return saveResult;
}
