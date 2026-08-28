import { z } from 'zod';

// Input/output for the estimateRecipeTimes flow (issue #952, phase 2) — "how long
// does this ACTUALLY take?", asked of a recipe that is already in the library.
//
// WHY A FLOW OF ITS OWN, when the three authoring paths now define the times
// properly (phase 1). Because phase 1 only fixes recipes authored AFTER it ships.
// Every recipe already stored carries the optimistic number the old one-line rule
// produced, and nothing re-asks: `onRecipeWritten` has no branch that touches
// times, and re-authoring the document is explicitly forbidden (the backfill must
// not go near ingredients, steps or `rawText`). So the re-estimate needs a path
// that reads a stored recipe and returns three numbers and nothing else.
//
// It is deliberately NOT an extra field on the librarian or either extractor:
// those are temperature-0 TRANSCRIBERS (docs/ai-kitchen-assistant.md § Scope
// boundaries), and this runs over what was already saved — the same posture
// identifyRecipeKit and describeRecipeScene take.
export const EstimateRecipeTimesInputSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  // Portions, because prep scales with them: dicing two onions is not dicing six.
  servings: z.number().nullable(),
  // Ingredient DISPLAY lines (rawText), flattened out of their groups. They are
  // most of the prep estimate — "3 large potatoes, peeled and diced" is knife
  // work the method may never spell out.
  ingredients: z.array(z.string()),
  // Step text with the step's own timer, when it has one. The timers are FACT
  // rather than estimate (a cook set them, or the authoring path read them off
  // the source), so they anchor `cookTimeMinutes` and the unattended waits that
  // `totalTimeMinutes` has to contain.
  steps: z.array(z.object({ text: z.string(), timerMinutes: z.number().nullable() })),
});

export type EstimateRecipeTimesInput = z.infer<typeof EstimateRecipeTimesInputSchema>;

// What the model emits, and it carries the SAME constraints as the two authoring
// paths (LibrarianOutputSchema, ExtractRecipeAIOutputSchema) because it is
// answering the same question against the same definition — a third set of
// constraints for the same three fields is how the three drift apart.
//
// The 0 rule stays asymmetric exactly as it is there (issue #739): a
// `totalTimeMinutes` of 0 describes a recipe nobody can cook and is a model
// glitch, while `prepTimeMinutes: 0` / `cookTimeMinutes: 0` are real answers for
// something assembled rather than cooked. `reconcileEstimatedTimes` folds a
// surviving 0 back to null before anything is written, so 0 never reaches a
// stored document — the same bargain assembleRecipeDraft makes.
export const EstimateRecipeTimesAIOutputSchema = z.object({
  prepTimeMinutes: z.number().int().nonnegative().nullable(),
  cookTimeMinutes: z.number().int().nonnegative().nullable(),
  totalTimeMinutes: z.number().int().positive().nullable(),
});

// The flow's output: the same three fields, reconciled against each other and
// zero-folded. Named separately from the AI output for the reason
// identifyRecipeKit and parseRecipeIngredients name theirs — they are the same
// shape today, and the seam is what keeps them free to differ.
export const EstimateRecipeTimesOutputSchema = z.object({
  prepTimeMinutes: z.number().int().positive().nullable(),
  cookTimeMinutes: z.number().int().positive().nullable(),
  totalTimeMinutes: z.number().int().positive().nullable(),
});

export type EstimateRecipeTimesOutput = z.infer<typeof EstimateRecipeTimesOutputSchema>;
