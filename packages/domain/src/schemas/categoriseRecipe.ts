import { z } from 'zod';

// Input/output for the categoriseRecipe flow (issue: tighten recipe categories).
// Given a recipe's content, the flow returns clean search/filter category tags
// under the shared category-tag rules — used to (re)categorise recipes without
// re-authoring them. Not a callable yet; consumed by the recategorise backfill
// and available to a future "re-categorise" UI action.
export const CategoriseRecipeInputSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  // Ingredient display lines (rawText), used only as context so the model can
  // tell what kind of dish it is — never to be echoed back as tags.
  ingredients: z.array(z.string()),
  // Course/method context helps the model pick dish-form/character tags.
  steps: z.array(z.string()).optional().default([]),
});

export type CategoriseRecipeInput = z.infer<typeof CategoriseRecipeInputSchema>;

// What the model emits inside the flow (never leaves the CF boundary before
// normalisation).
export const CategoriseRecipeAIOutputSchema = z.object({
  tags: z.array(z.string()),
});

export type CategoriseRecipeAIOutput = z.infer<typeof CategoriseRecipeAIOutputSchema>;

// The flow's normalised output: lowercase, kebab-cased, deduped category tags.
export const CategoriseRecipeOutputSchema = z.object({
  tags: z.array(z.string()),
});

export type CategoriseRecipeOutput = z.infer<typeof CategoriseRecipeOutputSchema>;
