import { z } from 'zod';

export const CanonItemSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(5),
  name: z.string(),
  synonyms: z.array(z.string()),
  aisleId: z.string().nullable(),
  thumbnail: z.string().nullable(),
  embedding: z.array(z.number()).nullable(),
  needs_approval: z.boolean(),
  shoppingBehavior: z.enum(['stocked', 'check', 'needed']),
  largeQuantityThreshold: z.number().optional(),
  unit: z.enum(['g', 'ml', 'count']).optional(),
  reasoning: z.string().optional(),
  updatedAt: z.string(),
});

export type CanonItemDoc = z.infer<typeof CanonItemSchema>;
