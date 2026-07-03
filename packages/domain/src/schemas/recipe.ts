import { z } from 'zod';

// Recipe document schema (issue #179). Validated on read in firebase-sync and on
// flow output in the parse CF (Phase 3). This is the single source of truth for
// the recipe shape: the recipe entity graph in packages/domain/src/recipe/entities
// aliases the inferred types below (issue #417), so entity and document can't drift.

// A plain numeric amount, e.g. "2", "0.5", "200".
export const SingleQuantitySchema = z.object({
  type: z.literal('single'),
  value: z.number(),
});

// A low–high amount, e.g. "2–3".
export const RangeQuantitySchema = z.object({
  type: z.literal('range'),
  min: z.number(),
  max: z.number(),
});

// A whole number plus an exact fraction, e.g. "1 ½" = { whole: 1, numerator: 1,
// denominator: 2 }; a bare "½" is whole 0. Stored as a fraction (not a decimal)
// so the original is preserved exactly. denominator is positive to stay a valid
// fraction.
export const MixedQuantitySchema = z.object({
  type: z.literal('mixed'),
  whole: z.number().int().nonnegative(),
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().positive(),
});

export const QuantitySchema = z.discriminatedUnion('type', [
  SingleQuantitySchema,
  RangeQuantitySchema,
  MixedQuantitySchema,
]);

export const ParsedIngredientSchema = z.object({
  quantity: QuantitySchema.nullable(),
  // Metric unit only. null for count/item-based ingredients (cloves, rashers, etc.)
  unit: z.enum(['g', 'ml']).nullable(),
  item: z.string(),
  preparation: z.array(z.string()),
  notes: z.string().nullable(),
  // Human-friendly display string for the original non-metric measure, e.g. "½ tsp"
  // or "1 cup". null when the source was already in g/ml or has no unit.
  // .default(null) so documents written before this field was added still parse.
  displayText: z.string().nullable().default(null),
});

export const IngredientSchema = z.object({
  id: z.string(),
  rawText: z.string(),
  parsed: ParsedIngredientSchema.nullable(),
  canonId: z.string().nullable(),
  matchState: z.enum(['pending', 'matched', 'failed']),
  isOptional: z.boolean(),
  firstUsedInStepId: z.string().nullable(),
});

export const IngredientGroupSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  items: z.array(IngredientSchema),
});

export const StepTimerSchema = z.object({
  durationMinutes: z.number(),
  description: z.string().nullable(),
});

export const StepSchema = z.object({
  id: z.string(),
  text: z.string(),
  timer: StepTimerSchema.nullable(),
  note: z.string().nullable(),
});

export const RecipeMetadataSchema = z.object({
  servings: z.number().nullable(),
  totalTimeMinutes: z.number().nullable(),
  prepTimeMinutes: z.number().nullable(),
  cookTimeMinutes: z.number().nullable(),
  tags: z.array(z.string()),
});

export const RecipeSourceSchema = z.object({
  type: z.enum(['url', 'book', 'manual']),
  url: z.string().optional(),
  book: z
    .object({
      title: z.string(),
      author: z.string(),
      page: z.number(),
    })
    .optional(),
});

export const RecipeImageSchema = z.object({
  url: z.string(),
  source: z.enum(['ai', 'upload']),
});

export const RecipeSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  title: z.string(),
  description: z.string().nullable(),
  ingredients: z.array(IngredientGroupSchema),
  steps: z.array(StepSchema),
  metadata: RecipeMetadataSchema,
  source: RecipeSourceSchema.nullable(),
  notes: z.string().nullable(),
  image: RecipeImageSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SingleQuantityDoc = z.infer<typeof SingleQuantitySchema>;
export type RangeQuantityDoc = z.infer<typeof RangeQuantitySchema>;
export type MixedQuantityDoc = z.infer<typeof MixedQuantitySchema>;
export type QuantityDoc = z.infer<typeof QuantitySchema>;
export type ParsedIngredientDoc = z.infer<typeof ParsedIngredientSchema>;
export type IngredientDoc = z.infer<typeof IngredientSchema>;
export type IngredientGroupDoc = z.infer<typeof IngredientGroupSchema>;
export type StepTimerDoc = z.infer<typeof StepTimerSchema>;
export type StepDoc = z.infer<typeof StepSchema>;
export type RecipeMetadataDoc = z.infer<typeof RecipeMetadataSchema>;
export type RecipeSourceDoc = z.infer<typeof RecipeSourceSchema>;
export type RecipeImageDoc = z.infer<typeof RecipeImageSchema>;
export type RecipeDoc = z.infer<typeof RecipeSchema>;
