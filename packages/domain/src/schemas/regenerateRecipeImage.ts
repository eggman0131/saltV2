import { z } from 'zod';

// Input for the regenerateRecipeImage callable (issue #148, Tier-2): clears the
// recipe's hero image so the onRecipeWritten trigger regenerates it (and un-hides
// it if it was hidden). An optional `hint` is a one-shot, additive steer for the
// next generation (e.g. "make it brighter", "show it in a rustic bowl"). Mirrors
// RegenerateCanonIconInputSchema.
export const RegenerateRecipeImageInputSchema = z.object({
  recipeId: z.string().min(1),
  hint: z.string().trim().max(200).optional(),
});

export type RegenerateRecipeImageInput = z.infer<typeof RegenerateRecipeImageInputSchema>;
