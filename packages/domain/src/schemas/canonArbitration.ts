import { z } from 'zod';

export const ArbitrationRequestSchema = z.object({
  normalisedName: z.string(),
  candidates: z.array(
    z.object({
      item: z.object({ id: z.string(), name: z.string() }),
      confidence: z.number(),
    }),
  ),
  aisles: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type ArbitrationRequestInput = z.infer<typeof ArbitrationRequestSchema>;

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
