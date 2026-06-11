import { z } from 'zod';

// Recipe document schema (issue #179). Validated on read in firebase-sync and on
// flow output in the parse CF (Phase 3). Mirrors the recipe entity graph in
// packages/domain/src/recipe/entities; schema-first, types are inferred below.

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
  unit: z.string().nullable(),
  item: z.string(),
  preparation: z.array(z.string()),
  notes: z.string().nullable(),
  // Metric conversion of volumetric measures: g for solids, ml for liquids.
  // null = no conversion applicable (already metric, item-based unit, or no quantity).
  // .default(null) so documents written before this field was added still parse.
  convertedWeight: z
    .object({ value: z.number(), unit: z.enum(['g', 'ml']) })
    .nullable()
    .default(null),
});

export const IngredientSchema = z.object({
  id: z.string(),
  rawText: z.string(),
  parsed: ParsedIngredientSchema.nullable(),
  canonId: z.string().nullable(),
  // SAME enum as shoppingListItem (issue #179).
  matchState: z.enum(['pending', 'matched', 'needs_approval', 'failed']),
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
