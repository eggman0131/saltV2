import { z } from 'zod';

const ManualSourceRefSchema = z.object({ kind: z.literal('manual') });

const RecipeSourceRefSchema = z.object({
  kind: z.literal('recipe'),
  recipeId: z.string(),
  servings: z.number(),
  label: z.string().optional(),
});

export const SourceRefSchema = z.discriminatedUnion('kind', [
  ManualSourceRefSchema,
  RecipeSourceRefSchema,
]);

export const ShoppingListItemSchema = z.object({
  id: z.string(),
  rawText: z.string(),
  notes: z.string(),
  sources: z.array(SourceRefSchema),
  canonId: z.string().nullable(),
  matchState: z.enum(['pending', 'matched', 'needs_approval', 'failed']),
  checked: z.boolean(),
  schemaVersion: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SourceRefDoc = z.infer<typeof SourceRefSchema>;
export type ShoppingListItemDoc = z.infer<typeof ShoppingListItemSchema>;
