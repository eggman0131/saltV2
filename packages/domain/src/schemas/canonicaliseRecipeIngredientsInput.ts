import { z } from 'zod';
import {
  MatchOrCreateCanonInputSchema,
  MatchOrCreateCanonOutputSchema,
} from './matchOrCreateCanonInput.js';

// One ingredient to canonicalise. This is exactly a single-item canon match
// without the manual `forceCreate` override, so it is DERIVED rather than
// restated (issue #932, B3-013): the two declared the same three fields —
// `rawName`, `rawText`, `selectedAisleId` — and could drift apart silently.
export const CanonicaliseRecipeIngredientsItemSchema = MatchOrCreateCanonInputSchema.omit({
  forceCreate: true,
});

export const CanonicaliseRecipeIngredientsInputSchema = z.object({
  items: z.array(CanonicaliseRecipeIngredientsItemSchema).min(1),
});

export type CanonicaliseRecipeIngredientsInput = z.infer<
  typeof CanonicaliseRecipeIngredientsInputSchema
>;

// One result per input item, in order — the same envelope a single canon match
// returns.
export const CanonicaliseRecipeIngredientsOutputSchema = z.array(MatchOrCreateCanonOutputSchema);
