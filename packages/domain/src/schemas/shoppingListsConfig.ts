import { z } from 'zod';

export const ShoppingListsConfigSchema = z.object({
  defaultListId: z.string(),
  schemaVersion: z.literal(1),
});

export type ShoppingListsConfigDoc = z.infer<typeof ShoppingListsConfigSchema>;
