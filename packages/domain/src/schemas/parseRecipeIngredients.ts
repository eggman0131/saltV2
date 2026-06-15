import { z } from 'zod';
import { QuantitySchema, IngredientGroupSchema } from './recipe.js';

export const ParseRecipeIngredientsInputSchema = z.object({
  rawText: z.string(),
});
export type ParseRecipeIngredientsInput = z.infer<typeof ParseRecipeIngredientsInputSchema>;

// Slim AI-generated shape: no IDs or matchState — the flow adds those after generation.
const ParsedIngredientAISchema = z.object({
  rawText: z.string(),
  quantity: QuantitySchema.nullable(),
  unit: z.enum(['g', 'ml']).nullable(),
  item: z.string(),
  preparation: z.array(z.string()),
  notes: z.string().nullable(),
  isOptional: z.boolean(),
  // Human-friendly original measure (e.g. "½ tsp"). null if source was already metric.
  displayText: z.string().nullable(),
});

const IngredientGroupAISchema = z.object({
  name: z.string().nullable(),
  items: z.array(ParsedIngredientAISchema),
});

export const ParseRecipeIngredientsAIOutputSchema = z.object({
  groups: z.array(IngredientGroupAISchema),
});
export type ParseRecipeIngredientsAIOutput = z.infer<typeof ParseRecipeIngredientsAIOutputSchema>;

// The flow's callable output schema — full IngredientGroup[] with IDs.
export const ParseRecipeIngredientsOutputSchema = z.array(IngredientGroupSchema);
export type ParseRecipeIngredientsOutput = z.infer<typeof ParseRecipeIngredientsOutputSchema>;
