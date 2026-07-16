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

// Per-product-form demand carried by a product-form shopping row (issue #501).
// `parentCount` is the UNROUNDED parent-count this form's raw amount converts to,
// so demands can be summed raw and rounded once at display time. Storing the
// fractional parent-count (not raw amount + yield) keeps the yield out of the doc.
const FormDemandSchema = z.object({
  formId: z.string(),
  parentCount: z.number(),
});

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
  // Product-form demand breakdown (issue #501). Present only on a product-form
  // parent row (one written with the `'count'` unit sentinel): one entry per form
  // of this parent the source recipe demanded, each carrying that form's own
  // unrounded parent-count. Without it the display layer can only MAX the
  // already-collapsed per-recipe counts, which under-counts two recipes wanting
  // the SAME form (zest 10 g + 15 g must buy 5 limes, not 3).
  //
  // Optional and additive: items written before this field (and every non-form
  // item) lack it and stay valid on read — they degrade to the old MAX-across-
  // recipes rule and keep their existing number (back-compat; no migration).
  formDemand: z.array(FormDemandSchema).optional(),
});

export type SourceRefDoc = z.infer<typeof SourceRefSchema>;
export type ShoppingListItemDoc = z.infer<typeof ShoppingListItemSchema>;
