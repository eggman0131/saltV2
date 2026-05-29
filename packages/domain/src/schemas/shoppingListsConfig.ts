import { z } from 'zod';

export const ShoppingListsConfigSchema = z.object({
  defaultListId: z.string().default(''),
  schemaVersion: z.literal(1).default(1),
});

export type ShoppingListsConfigDoc = z.infer<typeof ShoppingListsConfigSchema>;
