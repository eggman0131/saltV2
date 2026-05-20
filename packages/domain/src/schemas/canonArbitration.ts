import { z } from 'zod';

// Flat shape returned by the Gemini model in the canon-matching flow.
// Schema is the source of truth; the TS type is derived via z.infer.
export const CanonArbitrationAIOutputSchema = z.object({
  match_found: z.boolean(),
  match_id: z.string().nullable(),
  canonical_name: z.string().nullable(),
  aisle_name: z.string().nullable(),
  shoppingBehavior: z.enum(['stocked', 'check', 'needed']),
  largeQuantityThreshold: z.number().nullable(),
  unit: z.enum(['g', 'ml', 'count']).nullable(),
  reasoning: z.string(),
});

export type CanonArbitrationAIOutput = z.infer<typeof CanonArbitrationAIOutputSchema>;
