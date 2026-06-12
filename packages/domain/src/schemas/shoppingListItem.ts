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
  id: z.string().default(''),
  rawText: z.string().default(''),
  notes: z.string().default(''),
  sources: z.array(SourceRefSchema).default([]),
  canonId: z.string().nullable().default(null),
  matchState: z.enum(['pending', 'matched', 'needs_approval', 'failed']).catch('pending'),
  amount: z.number().optional(),
  unit: z.string().optional(),
  checked: z.boolean().default(false),
  needsCheck: z.boolean().default(false),
  schemaVersion: z.literal(1).default(1),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
});

export type SourceRefDoc = z.infer<typeof SourceRefSchema>;
export type ShoppingListItemDoc = z.infer<typeof ShoppingListItemSchema>;
