import { z } from 'zod';

export const CanonItemSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(5),
  name: z.string(),
  synonyms: z.array(z.string()),
  aisleId: z.string().nullable(),
  thumbnail: z.string().nullable(),
  // Transient one-shot steer for the next icon (re)generation (issue #148).
  // Written by the regenerateCanonIcon callable alongside thumbnail: null;
  // consumed and cleared by the onCanonItemWritten icon branch.
  iconHint: z.string().optional(),
  // Regenerate nonce (epoch ms): the regenerateCanonIcon callable stamps this on
  // every request so the write always mutates the doc — even when thumbnail is
  // already null — which is what re-fires the onCanonItemWritten icon branch
  // (Firestore emits no write event for a no-op update). Number, not a Firestore
  // Timestamp, so both the trigger and the client subscription parse it cleanly.
  iconRequestedAt: z.number().optional(),
  embedding: z.array(z.number()).nullable(),
  needs_approval: z.boolean(),
  shoppingBehavior: z.enum(['stocked', 'check', 'needed']),
  largeQuantityThreshold: z.number().optional(),
  unit: z.enum(['g', 'ml', 'count']).optional(),
  reasoning: z.string().optional(),
  updatedAt: z.string(),
});

export type CanonItemDoc = z.infer<typeof CanonItemSchema>;
