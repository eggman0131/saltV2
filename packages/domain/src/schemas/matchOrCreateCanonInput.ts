import { z } from 'zod';

export const MatchOrCreateCanonInputSchema = z.object({
  rawName: z.string(),
  selectedAisleId: z.string().nullable().optional(),
  forceCreate: z.boolean().optional(),
});

export type MatchOrCreateCanonInput = z.infer<typeof MatchOrCreateCanonInputSchema>;
