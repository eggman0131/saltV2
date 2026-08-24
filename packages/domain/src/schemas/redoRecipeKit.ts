import { z } from 'zod';

// Input for the redoRecipeKit callable (issue #882): re-ask "what does this dish
// need me to get out?" for one recipe. Mirrors RegenerateCanonIconInputSchema —
// an id and nothing else. There is no hint and no brief to carry: unlike a hero
// image, a kit list has no art direction to steer, only a recipe to read again.
export const RedoRecipeKitInputSchema = z.object({
  recipeId: z.string().min(1),
});
