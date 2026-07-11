import { z } from 'zod';
import { StepTimerSchema } from './recipe.js';

// Structured diff between an existing recipe and an edited draft (issue-scoped
// Phase 1). PURE data: `diffRecipe` (packages/domain/src/recipe/queries) produces
// it and it carries only human-signal changes, so a client can render a
// deterministic section-grouped summary ("Added: 200g crème fraîche", "Cook time
// 40 → 55 min", "Rewrote step 3"). Machine-derived fields (canonId, matchState,
// parsed, updatedAt, image, source, ids-as-content, createdAt, schemaVersion,
// producesCanonId, firstUsedInStepId) are ignored — they are keys or noise, not
// signal. This schema is a render contract, not a Firestore document: it is never
// persisted, so there is no back-compat surface.

// A change on a required string field (title). `from !== to` by construction.
export const RecipeFieldChangeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

// A change on a nullable string field (description, notes, step note). null means
// "cleared"/"unset"; a null→string or string→null transition is a real change.
export const NullableStringChangeSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
});

// A change on a nullable numeric metadata field (servings + the time fields).
export const NullableNumberChangeSchema = z.object({
  from: z.number().nullable(),
  to: z.number().nullable(),
});

// One added or removed ingredient, item-level (flattened across groups). Ingredient
// identity for the summary is its `rawText`; `id` is carried for keying only.
export const IngredientDiffEntrySchema = z.object({
  id: z.string(),
  rawText: z.string(),
});

// An edited ingredient (same id reused, `rawText` reworded), keyed by id.
export const IngredientChangeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
});

export const IngredientsDiffSchema = z.object({
  added: z.array(IngredientDiffEntrySchema),
  removed: z.array(IngredientDiffEntrySchema),
  changed: z.array(IngredientChangeSchema),
});

// A step's timer changing (added, removed, or re-timed). null = no timer.
export const StepTimerChangeSchema = z.object({
  from: StepTimerSchema.nullable(),
  to: StepTimerSchema.nullable(),
});

// An added or removed step. `position` is the 1-based index (in the draft for an
// added step, in the existing recipe for a removed one) so the client can say
// "step 3".
export const StepDiffEntrySchema = z.object({
  id: z.string(),
  position: z.number().int().positive(),
  text: z.string(),
});

// An edited step (same id reused, or same `text` matched by fallback). `position`
// is the 1-based index in the draft. Each of text/timer/note is present only when
// that facet changed; at least one is always present.
export const StepChangeSchema = z.object({
  id: z.string(),
  position: z.number().int().positive(),
  text: RecipeFieldChangeSchema.optional(),
  timer: StepTimerChangeSchema.optional(),
  note: NullableStringChangeSchema.optional(),
});

export const StepsDiffSchema = z.object({
  added: z.array(StepDiffEntrySchema),
  removed: z.array(StepDiffEntrySchema),
  changed: z.array(StepChangeSchema),
});

// Per-field metadata changes. A field is present only when it changed.
export const RecipeMetadataDiffSchema = z.object({
  servings: NullableNumberChangeSchema.optional(),
  totalTimeMinutes: NullableNumberChangeSchema.optional(),
  prepTimeMinutes: NullableNumberChangeSchema.optional(),
  cookTimeMinutes: NullableNumberChangeSchema.optional(),
});

// Tag set change. `added`/`removed` are the set difference (draft − existing and
// existing − draft), in first-seen order of their source list.
export const TagsDiffSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
});

// The full recipe diff. `ingredients`, `steps`, `metadata`, and `tags` are always
// present (with empty arrays / no per-field keys) so the render shape is stable;
// `title`/`description`/`notes` are present only when changed. `hasChanges` is the
// single no-op signal: false ⟺ every section is empty. Pure reorders with no
// content change are intentionally NOT reported (identity is by id then content,
// so a moved-but-unchanged item matches and is omitted) — add/remove/change
// clarity is the priority for the summary UX.
export const RecipeDiffSchema = z.object({
  hasChanges: z.boolean(),
  title: RecipeFieldChangeSchema.optional(),
  description: NullableStringChangeSchema.optional(),
  notes: NullableStringChangeSchema.optional(),
  ingredients: IngredientsDiffSchema,
  steps: StepsDiffSchema,
  metadata: RecipeMetadataDiffSchema,
  tags: TagsDiffSchema,
});

export type RecipeFieldChange = z.infer<typeof RecipeFieldChangeSchema>;
export type NullableStringChange = z.infer<typeof NullableStringChangeSchema>;
export type NullableNumberChange = z.infer<typeof NullableNumberChangeSchema>;
export type IngredientDiffEntry = z.infer<typeof IngredientDiffEntrySchema>;
export type IngredientChange = z.infer<typeof IngredientChangeSchema>;
export type IngredientsDiff = z.infer<typeof IngredientsDiffSchema>;
export type StepTimerChange = z.infer<typeof StepTimerChangeSchema>;
export type StepDiffEntry = z.infer<typeof StepDiffEntrySchema>;
export type StepChange = z.infer<typeof StepChangeSchema>;
export type StepsDiff = z.infer<typeof StepsDiffSchema>;
export type RecipeMetadataDiff = z.infer<typeof RecipeMetadataDiffSchema>;
export type TagsDiff = z.infer<typeof TagsDiffSchema>;
export type RecipeDiff = z.infer<typeof RecipeDiffSchema>;
