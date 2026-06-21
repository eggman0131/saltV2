import { z } from 'zod';
import { RecipeSchema } from './recipe.js';

// SSRF-hardened URL import (recipe URL import epic, Phase 1).
//
// Input: a single user-supplied web address. Output: a fully-assembled recipe
// draft (the same shape as a stored recipe document) with `source.type = 'url'`.
// The client adds nothing — it hydrates the editor straight from this draft.

export const ExtractRecipeFromUrlInputSchema = z.object({
  // Validated again inside the flow against the SSRF guard; here we only assert
  // it is a non-empty string. The flow rejects non-https / private hosts.
  url: z.string().min(1),
});

export type ExtractRecipeFromUrlInput = z.infer<typeof ExtractRecipeFromUrlInputSchema>;

// The flow returns a complete recipe draft. Reuse the canonical RecipeSchema so
// the draft is guaranteed to be a valid, persistable recipe document.
export const ExtractRecipeFromUrlOutputSchema = RecipeSchema;

export type ExtractRecipeFromUrlOutput = z.infer<typeof ExtractRecipeFromUrlOutputSchema>;

// The closed set of user-facing failure modes for URL import. The CF flow tags
// each failure with one of these; the callable wrapper re-derives it from the
// HttpsError code so the client can show the right copy without leaking SSRF
// internals. Defined here (pure type) so the CF, the wrapper, and the web copy
// map all agree on the same vocabulary.
//   - invalid-url: not a valid web address.
//   - blocked-url: refused by the SSRF guard (non-https / private / internal).
//   - fetch-failed: DNS / connect / timeout / non-200 / too-large / wrong type.
//   - not-a-recipe: page fetched but no recipe found.
//   - ai-failed: AI timeout or unparseable/invalid model output.
export const URL_IMPORT_FAILURE_CODES = [
  'invalid-url',
  'blocked-url',
  'fetch-failed',
  'not-a-recipe',
  'ai-failed',
] as const;

export type UrlImportFailureCode = (typeof URL_IMPORT_FAILURE_CODES)[number];

// ─── AI extraction output ─────────────────────────────────────────────────────
// The shape Gemini emits inside the flow (never leaves the CF boundary). The
// model extracts the recipe AND converts everything to metric + British
// spelling/terms/ingredient names. Ingredient `rawText` is the British/metric
// line that then feeds the existing parse/canonicalise flows. Step ordinals are
// resolved to step IDs by the flow before the RecipeDoc is assembled — mirrors
// the librarian (authorRecipe) flow.

export const ExtractedIngredientSchema = z.object({
  // The ingredient line, already converted to metric + British spelling/terms.
  rawText: z.string(),
  isOptional: z.boolean(),
  // 0-based index into the steps array for the first step that uses this
  // ingredient. null = no specific step assignment.
  firstUsedInStepOrdinal: z.number().int().nullable(),
});

export const ExtractedIngredientGroupSchema = z.object({
  name: z.string().nullable(),
  ingredients: z.array(ExtractedIngredientSchema),
});

export const ExtractedStepSchema = z.object({
  text: z.string(),
  timerMinutes: z.number().int().nullable(),
  note: z.string().nullable(),
});

export const ExtractRecipeAIOutputSchema = z.object({
  // false when the page is not a recipe at all → maps to the not-a-recipe
  // failure. true with a populated recipe otherwise.
  isRecipe: z.boolean(),
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().nullable(),
  totalTimeMinutes: z.number().nullable(),
  prepTimeMinutes: z.number().nullable(),
  cookTimeMinutes: z.number().nullable(),
  tags: z.array(z.string()),
  ingredientGroups: z.array(ExtractedIngredientGroupSchema),
  steps: z.array(ExtractedStepSchema),
  notes: z.string().nullable(),
});

export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>;
export type ExtractedIngredientGroup = z.infer<typeof ExtractedIngredientGroupSchema>;
export type ExtractedStep = z.infer<typeof ExtractedStepSchema>;
export type ExtractRecipeAIOutput = z.infer<typeof ExtractRecipeAIOutputSchema>;
