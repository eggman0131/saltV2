import type { Recipe } from '@salt/domain';
import type { AuthorRecipeInput } from '@salt/domain/schemas';
import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
import { trackUsageEvent } from '@salt/observability';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { authorRecipeTraced, stampRecipeAttribution } from './recipeService.js';

// Authoring a NEW recipe out of a conversation — the create leg (issues #696,
// #763, #798).
//
// This is the ONE implementation, for the same reason `recipeAmend.ts` is the one
// implementation of the review gate (#791): the propose/apply pair was written
// twice, drifted, and had to be pulled back together. There are now three doors
// onto this leg — the full `/chat/:id` page's "Save as recipe", and "Save as new
// recipe" in the recipe page's docked chat column and its drawer — so the saved
// document must not depend on which one you came through.
//
// The division of labour is `recipeAmend`'s: this module decides what gets
// written and writes it. A page owns its own busy state, its toasts, where it
// navigates afterwards, and whether the conversation goes on to claim the recipe
// it produced. **Claiming is deliberately not in here.** A general chat claims
// (the conversation now belongs to the dish it invented); a chat attached to a
// recipe does not (it belongs to the dish it is attached to and stays listed
// there, and the new recipe has no origin chat).

/**
 * Which leg failed. Both are worth different words on screen — "the chef could
 * not write it" is a retry, "it was written but not kept" is not the same news —
 * and every surface phrases them the same way because they all read this.
 */
export type ChatAuthorStage = 'author' | 'save';

export interface ChatAuthorFailure {
  stage: ChatAuthorStage;
  error: DomainError;
}

export interface AuthorRecipeFromChatInput {
  /** The transcript. The base recipe of an attached chat is NOT in here — it is
   *  injected server-side by `chefChat` — which is what makes create mode's
   *  "extract only what is present in the conversation" a safe instruction. */
  messages: AuthorRecipeInput['messages'];
  /** The vocabulary already in use, so the librarian reuses tags rather than inventing near-misses. */
  existingTags: string[];
  /**
   * Variation mode (#763): the dish this conversation started from, grounding the
   * prose so the new recipe carries forward what was never discussed. A parameter
   * rather than something inferred here, because it is a decision about the
   * relationship and only the caller knows it — "Save as new recipe" on an
   * attached chat passes `null` on purpose: an accompaniment is not derived from
   * the dish it accompanies, and variation mode would drag that dish's
   * ingredients into it.
   */
  basedOnRecipeId?: string | null;
}

/**
 * Author a brand-new recipe from a conversation and save it.
 *
 * Always the CREATE path — no `recipeId` is ever sent, so the flow assembles with
 * no base recipe and the result is an independent dish with its own title, its
 * own hero (`image: null`, so the trigger generates one from the new content),
 * `source: manual` and no `producesCanonId`. Nothing existing is written to.
 *
 * `createdAt`/`updatedAt` are stamped here rather than at the call sites: the
 * librarian has no clock, and three surfaces stamping their own would be three
 * chances to forget one.
 */
export async function authorRecipeFromChat(
  input: AuthorRecipeFromChatInput,
): Promise<ReadResult<Recipe, ChatAuthorFailure>> {
  // No title hint: the dish being authored has no name yet, and the only title in
  // reach on the recipe page is the WRONG dish's. The span stays 'Author recipe'.
  const result = await authorRecipeTraced({
    messages: input.messages,
    existingTags: input.existingTags,
    basedOnRecipeId: input.basedOnRecipeId ?? null,
  });
  if (result.kind !== 'ok') return failure({ stage: 'author', error: result.error });

  const now = new Date().toISOString();
  // Attribution rides with the clock and for the same reason (issue #845): the
  // librarian knows no more about who you are than it does about what time it is,
  // and this path writes through `saveRecipeDoc` rather than `persistRecipe`, so
  // it stamps here or not at all. A chat-authored recipe is yours — you had the
  // conversation — so it is `createdBy` you, exactly as if you had typed it in.
  const saved: Recipe = stampRecipeAttribution({
    ...result.value,
    createdAt: now,
    updatedAt: now,
  });

  const saveResult = await saveRecipeDoc(saved);
  if (saveResult.kind !== 'ok') return failure({ stage: 'save', error: saveResult.error });

  // Fired here, once, so a fourth door cannot arrive without its telemetry.
  // `recipe_method: 'chat'` is what this is on every surface — the taxonomy is a
  // deliberately small closed set and does not grow a value per button.
  trackUsageEvent('recipe.created', {
    recipe_id: saved.id,
    recipe_kind: saved.kind,
    recipe_method: 'chat',
  });

  return success(saved);
}
