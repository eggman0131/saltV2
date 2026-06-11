import { z } from 'zod';

export const CanonicaliseRecipeIngredientsItemSchema = z.object({
  rawName: z.string(),
  rawText: z.string().optional(),
  selectedAisleId: z.string().nullable().optional(),
});

export const CanonicaliseRecipeIngredientsInputSchema = z.object({
  items: z.array(CanonicaliseRecipeIngredientsItemSchema).min(1),
});

export type CanonicaliseRecipeIngredientsItem = z.infer<
  typeof CanonicaliseRecipeIngredientsItemSchema
>;
export type CanonicaliseRecipeIngredientsInput = z.infer<
  typeof CanonicaliseRecipeIngredientsInputSchema
>;
