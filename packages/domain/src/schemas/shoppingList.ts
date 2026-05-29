import { z } from 'zod';

export const ShoppingListSchema = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  schemaVersion: z.literal(1).default(1),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
});

export type ShoppingListDoc = z.infer<typeof ShoppingListSchema>;
