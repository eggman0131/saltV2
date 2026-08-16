import { diffRecipe, type Recipe } from '@salt/domain';
import type { AuthorRecipeInput, RecipeDiff, RecipeDoc } from '@salt/domain/schemas';
import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
import { success, type DomainError, type ReadResult } from '@salt/shared-types';
import { authorRecipeTraced, stampRecipeAttribution } from './recipeService.js';

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
// THREE callers now (issue #784): the two chat surfaces above, and ⋮ → Refresh,
// which re-runs the librarian over the recipe with no conversation at all. It
// enters at `proposeRecipeRefresh` and shares everything downstream of the
// librarian call, so what "propose" and "apply" mean cannot fork a third way.

export interface RecipeAmendment {
  /** The merged recipe, ready to save. Nothing is written until `applyRecipeAmendment`. */
  updated: Recipe;
  /** What changed, for the review summary. Diffed POST-merge, so preserved fields show no row. */
  diff: RecipeDiff;
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
 * Re-run the librarian over the recipe ITSELF and return a PENDING proposal —
 * the same dish, re-transcribed under today's house writing rules (issue #784).
 *
 * A sibling of `proposeRecipeAmendment`, not a second gate: both build a
 * librarian input, and everything after that — the merge, the post-merge diff,
 * and `applyRecipeAmendment` — is the one shared implementation below. The only
 * difference is what the librarian is asked to read, and a refresh's answer is
 * "the recipe, and nothing else": `messages: []`, because there is no
 * conversation, and `refresh: true`, because the server cannot tell a refresh
 * from an edit by `recipeId` alone.
 *
 * `existingTags` still rides along — the tag vocabulary is a house rule like any
 * other, and re-applying it is part of what a refresh is for.
 */
export async function proposeRecipeRefresh(
  existing: Recipe,
  existingTags: string[],
): Promise<ReadResult<RecipeAmendment, DomainError>> {
  return propose(existing, { messages: [], existingTags, recipeId: existing.id, refresh: true });
}

/**
 * The shared half: call the librarian, merge its draft onto the recipe, diff
 * post-merge. Every propose in this module goes through here, so a refresh
 * cannot acquire a different idea of what a proposal IS than a chat amendment
 * has — which is the whole reason #764 collapsed two copies into one.
 */
async function propose(
  existing: Recipe,
  input: AuthorRecipeInput,
): Promise<ReadResult<RecipeAmendment, DomainError>> {
  const result = await authorRecipeTraced(input, existing.title);
  if (result.kind !== 'ok') return result;

  const updated = mergeAmendedRecipe(existing, result.value, new Date().toISOString());
  return success({ updated, diff: diffRecipe(existing, updated) });
}

/**
 * Commit a proposal — the gate's confirm. A one-line pass through to the
 * adapter, and deliberately so: it keeps the save on the same seam as the
 * propose, so the two surfaces cannot acquire different ideas about what
 * applying means the way they did about merging.
 *
 * The one thing it adds is attribution (issue #845): confirming a proposal IS
 * the human edit, so the amender is stamped here — on the write, not on a
 * proposal that may be discarded. `createdBy` is untouched by that stamp when it
 * already holds a name, so amending someone else's recipe by chat credits you as
 * the editor and leaves them as the one who added it.
 */
export async function applyRecipeAmendment(
  amendment: RecipeAmendment,
): Promise<ReadResult<void, DomainError>> {
  return saveRecipeDoc(stampRecipeAttribution(amendment.updated));
}
