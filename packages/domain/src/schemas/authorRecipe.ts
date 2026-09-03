import { z } from 'zod';
import { MessageSchema } from './chatSession.js';
import { AuthoredRecipePhasesSchema, AuthoredTimingSummarySchema, RecipeSchema } from './recipe.js';
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

// What the librarian flow returns: a complete, persistable recipe document.
// The canonical RecipeSchema, exactly as the two extractor flows use it — a
// draft that does not satisfy it is not a recipe, whichever path authored it.
export const AuthorRecipeOutputSchema = RecipeSchema;

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
  // NO LONGER ASKED FOR (issue #1233). The prompt stopped naming these three, so
  // the model stops returning them — and `.optional()` is what keeps that from
  // failing `.safeParse` at the trust boundary and taking every authoring call
  // with it. Absent means the same as null here; the assembler writes null.
  //
  // The constraints below still apply to a value that DOES arrive, because the
  // relaxation is about presence, not about range — but a value that FAILS them
  // now degrades to null (`.catch(null)`) rather than failing the parse, the same
  // posture `AuthoredRecipePhasesSchema` takes on `phases` below and for the same
  // reason: these are decorative fields nothing reads, and the librarian has no
  // retry, so a stray `12.5` or `0` from a model that was never asked for the
  // number must not cost the user their whole chat-authored recipe. Kept rather
  // than deleted only until #1211 removes the three keys from
  // `RecipeMetadataSchema` and sweeps the fixtures. The 0 rule they encode (issue
  // #739) is recorded beside the extractor's copy.
  totalTimeMinutes: z.number().int().positive().nullable().optional().catch(null),
  prepTimeMinutes: z.number().int().nonnegative().nullable().optional().catch(null),
  cookTimeMinutes: z.number().int().nonnegative().nullable().optional().catch(null),
  // The recipe's timing as an ordered strip (issue #1122), which is what it will
  // BE once the three numbers above retire. Shared shape rather than a fourth
  // hand-written copy: the librarian, both extractors and the re-estimator answer
  // one question against one definition (`PHASE_RULES`), and a per-file constraint
  // is how three of them come to mean three different things (#785, #952).
  //
  // `.optional()` on both so a model that omits them yields no strip rather than
  // failing the whole import on a field the prompt asks for and it forgot. The
  // assembler turns absent into an empty list on the way to the document.
  // `AuthoredRecipePhasesSchema` carries the matching guard for a strip the model
  // DID return but got wrong (a seventh block, a fractional minute): it degrades
  // to `[]` rather than failing this parse — load-bearing here specifically,
  // because the librarian has no retry (issue #1122 review, blocking 3).
  phases: AuthoredRecipePhasesSchema.optional(),
  timingSummary: AuthoredTimingSummarySchema.optional(),
  tags: z.array(z.string()),
  ingredientGroups: z.array(ExtractedIngredientGroupSchema),
  steps: z.array(ExtractedStepSchema),
  notes: z.string().nullable(),
});

export type LibrarianOutput = z.infer<typeof LibrarianOutputSchema>;
