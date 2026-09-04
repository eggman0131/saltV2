import { z } from 'zod';

// The chef's `readRecipe` tool (issue #840, phase 2) — the second and LAST tool
// the chef gets. Beside `findRecipes.ts`, and for the same reason: the shape is
// named by the Cloud Function and read by the model, so a second declaration of
// it is a place for the two to drift.
//
// Every `.describe()` below is PROMPT TEXT Genkit shows the model, not
// documentation. Edit it as prompt work.
//
// Why there is no `RecipeReadProjectionSchema` here to match phase 1's: reading a
// dish properly is the whole point of this tool, so it reads the WHOLE document
// through the renderer the chef already uses. The projection in `findRecipes.ts`
// exists to keep a SEARCH cheap; a read is the case that legitimately pays.

export const ReadRecipeInputSchema = z.object({
  id: z
    .string()
    .describe(
      'The id of a saved dish, exactly as findRecipes returned it. You cannot guess or ' +
        'construct one — if you have not seen the dish come back from a search, search first.',
    ),
});

export type ReadRecipeInput = z.infer<typeof ReadRecipeInputSchema>;

export const ReadRecipeOutputSchema = z.object({
  /**
   * False for a dish that is not there.
   *
   * A separate flag rather than a null `recipe` alone, because the two need
   * different answers from the chef: "there is no such dish" is something to say
   * out loud, and it is what a stale id from earlier in the conversation looks
   * like after the household deleted the recipe.
   */
  found: z.boolean().describe('False when there is no such dish. Say so; do not invent one.'),
  recipe: z
    .string()
    .nullable()
    .describe(
      'The whole dish as text — ingredients, method, timings, notes, and the dishes it is ' +
        'built from if it is a meal. Null when found is false.',
    ),
});

export type ReadRecipeOutput = z.infer<typeof ReadRecipeOutputSchema>;
