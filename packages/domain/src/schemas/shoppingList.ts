import { z } from 'zod';

export const ShoppingListSchema = z.object({
  id: z.string(),
  name: z.string(),
  schemaVersion: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ShoppingListDoc = z.infer<typeof ShoppingListSchema>;
