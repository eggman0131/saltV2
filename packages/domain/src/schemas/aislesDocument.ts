import { z } from 'zod';

export const AisleSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number(),
});

export type AisleDoc = z.infer<typeof AisleSchema>;

export const AislesDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  aisles: z.array(AisleSchema),
});
