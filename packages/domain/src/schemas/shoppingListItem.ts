import { z } from 'zod';

const ManualSourceRefSchema = z.object({
  kind: z.literal('manual'),
  // First name of the member who added the item. Optional: omitted on items
  // added before this field existed, and when the adder can't be resolved.
  addedBy: z.string().optional(),
});

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
  // Distributed-trace correlation field (issue #362, Phase 5). A W3C
  // `traceparent` string the browser stamps onto the item at "add to shopping
  // list" so the onShoppingListItemWrite trigger can continue the browser-rooted
  // trace (it has no inbound HTTP headers to extract from). TRANSPORT ONLY —
  // domain logic must never branch on it; it just rides on the doc. Optional and
  // additive: old docs lack it and stay valid (back-compat on read).
  traceContext: z.string().optional(),
});

export type SourceRefDoc = z.infer<typeof SourceRefSchema>;
export type ShoppingListItemDoc = z.infer<typeof ShoppingListItemSchema>;
