import { z } from 'zod';

export const MatchOrCreateCanonInputSchema = z.object({
  rawName: z.string(),
  selectedAisleId: z.string().nullable().optional(),
  forceCreate: z.boolean().optional(),
  rawText: z.string().optional(),
});
