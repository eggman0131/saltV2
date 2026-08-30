import { z } from 'zod';
import { MessageSchema } from './chatSession.js';
import { ExtractedIngredientGroupSchema, ExtractedStepSchema } from './extractRecipeFromUrl.js';

// Input to the librarian (authorRecipe) flow: the full conversation that the
// user wants to turn into a recipe (issue #206, Phase 4).
export const AuthorRecipeInputSchema = z.object({
  messages: z.array(MessageSchema),
  existingTags: z.array(z.string()).optional().default([]),
  // Edit mode: when set, the flow reads this existing recipe from Firestore and
  // grounds the librarian on it, returning the COMPLETE recipe with the
  // conversation's changes applied. Omitted/null = author a fresh recipe from
  // the conversation alone (create mode).
  recipeId: z.string().nullable().optional(),
  // Variation mode (issue #763): the recipe this conversation started from. The
  // flow reads it to GROUND the prose — so the draft carries forward everything
  // the conversation never mentioned — but still assembles in create mode, so
  // the new recipe gets its own identity: no `producesCanonId` carried, no image
  // shared with the original, and a title authored from the conversation rather
  // than force-preserved. `recipeId` wins if both are somehow set; a variation
  // chat has no `recipeId` until it claims the recipe it produced.
  basedOnRecipeId: z.string().nullable().optional(),
});

export type AuthorRecipeInput = z.infer<typeof AuthorRecipeInputSchema>;

// The shape the AI model emits inside the flow (never leaves the CF boundary).
// The model uses 0-based step ordinals for ingredient links; the flow resolves
// them to step IDs before returning the final RecipeDoc to the client.
//
// The three sub-shapes are the EXTRACTOR's (issue #932, B3-003 structural half).
// `LibrarianIngredientSchema` / `LibrarianGroupSchema` / `LibrarianStepSchema`
// were byte-identical restatements of `ExtractedIngredientSchema` /
// `ExtractedIngredientGroupSchema` / `ExtractedStepSchema`, so they are gone and
// this consumes those directly — one declaration per shape.
//
// The four top-level numeric fields carry the EXTRACTOR's constraints — the three
// time fields since #952, `servings` since #1123 — so the two schemas accept and
// reject the same numbers. `authorRecipe.schema.test.ts` runs one value matrix
// through both and asserts they agree, because "they match" is otherwise a
// sentence nothing falsifies when one of them is edited alone.
export const LibrarianOutputSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  // The extractor's constraint, for the extractor's reason (issue #739): a recipe
  // that serves nobody is a model glitch, not an answer. It is also the one of
  // these four numbers that anything DIVIDES by — a stored 0 scaled a shopping
  // list by Infinity (issue #1123) — so this path was the last one able to mint
  // that state.
  servings: z.number().int().positive().nullable(),
  // Same time constraints as the extractor (ExtractRecipeAIOutputSchema), and
  // for the same reasons — the librarian was the one authoring path that would
  // accept a fractional or negative minute count and store it (issue #952).
  //
  // The 0 rule is asymmetric on purpose (issue #739): `totalTimeMinutes: 0`
  // describes a recipe nobody can cook, so 0 there is a model glitch and stays
  // rejected, while `prepTimeMinutes: 0` / `cookTimeMinutes: 0` are real answers
  // for anything assembled rather than cooked. Read the fuller reasoning beside
  // the extractor's copy before changing either. 0 does not survive to the
  // stored recipe in any case: assembleRecipeDraft folds it back to null once it
  // has reconciled the total.
  totalTimeMinutes: z.number().int().positive().nullable(),
  prepTimeMinutes: z.number().int().nonnegative().nullable(),
  cookTimeMinutes: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string()),
  ingredientGroups: z.array(ExtractedIngredientGroupSchema),
  steps: z.array(ExtractedStepSchema),
  notes: z.string().nullable(),
});

export type LibrarianOutput = z.infer<typeof LibrarianOutputSchema>;
