import { z } from 'zod';
import { RecipeKitEntrySchema } from './recipe.js';

// Input/output for the identifyRecipeKit flow (issue #882) — "what do I need to
// get out?" answered from the WHOLE stored recipe.
//
// It is a SEPARATE flow rather than an extra field on the librarian or the URL
// extractor, and that is a scope rule rather than a preference: those two are
// temperature-0 TRANSCRIBERS (docs/ai-kitchen-assistant.md § Scope boundaries) and
// must never be handed anything that licenses them to rewrite a recipe. Kit is
// INFERENCE — "mash the potatoes" needs a masher the recipe never names — so it
// runs afterwards, over what was actually saved, exactly as describeRecipeScene
// does for the hero.
//
// THE LOAD-BEARING DECISION: `label` is FREE TEXT, and there is deliberately no
// `z.enum` over the drawn vocabulary anywhere in this file. A constrained enum
// would force the model to return a member of the list, so a recipe needing a
// potato masher would come back asking for a fork — confidently, and wrongly. The
// vocabulary is resolved against these words at DISPLAY time; a label nothing
// matches renders as words with no picture, which is the correct answer and costs
// nothing. Growing the vocabulary later fixes the picture without touching a
// single recipe.
export const IdentifyRecipeKitInputSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  // Ingredient DISPLAY lines (rawText), flattened out of their groups — the flow
  // wants what the dish is made of, not how the list is arranged. They matter
  // because they carry form as well as content: "300g floury potatoes" and "a
  // block of parmesan" each imply a tool the method may never name.
  ingredients: z.array(z.string()),
  // The steps WITH their ids, which is the one place this input differs from
  // categoriseRecipe's and describeRecipeScene's. The flow has to say which steps
  // use each piece of kit, so it needs the ids the recipe document actually
  // carries — it can neither invent them nor be handed ordinals to map back.
  steps: z.array(z.object({ id: z.string(), text: z.string() })),
});

export type IdentifyRecipeKitInput = z.infer<typeof IdentifyRecipeKitInputSchema>;

// What the model emits. Structurally identical to what lands on the document,
// because there is nothing to translate — but it is its own schema all the same:
// this is the trust boundary (`.safeParse` at the AI seam), and everything it
// returns is then SANITISED before it is written (hallucinated step ids dropped,
// blank labels dropped, duplicates collapsed). See `sanitiseRecipeKit`.
export const IdentifyRecipeKitAIOutputSchema = z.object({
  kit: z.array(RecipeKitEntrySchema),
});

export type IdentifyRecipeKitAIOutput = z.infer<typeof IdentifyRecipeKitAIOutputSchema>;

// The flow's output: the same shape, sanitised against the recipe it was asked
// about. Named separately from the AI output for the reason parseRecipeIngredients
// and categoriseRecipe name theirs — the two are the same today, and the seam is
// what keeps them free to differ.
export const IdentifyRecipeKitOutputSchema = z.object({
  kit: z.array(RecipeKitEntrySchema),
});

export type IdentifyRecipeKitOutput = z.infer<typeof IdentifyRecipeKitOutputSchema>;
