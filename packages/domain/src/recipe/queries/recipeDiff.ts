import type { StepTimerDoc } from '../../schemas/recipe.js';
import type { RecipePhase } from '../entities/Recipe.js';

// Structured diff between an existing recipe and an edited draft (issue-scoped
// Phase 1). PURE data: `diffRecipe` (packages/domain/src/recipe/queries) produces
// it and it carries only human-signal changes, so a client can render a
// deterministic section-grouped summary ("Added: 200g crème fraîche", "Cook time
// 40 → 55 min", "Rewrote step 3"). Machine-derived fields (canonId, matchState,
// parsed, updatedAt, image, source, ids-as-content, createdAt, schemaVersion,
// producesCanonId, firstUsedInStepId) are never REPORTED — they are keys or
// noise, not something a reviewer needs a row about. That is a statement about
// this render contract, not about the matcher: `diffRecipe` reads `canonId` as
// identity evidence when pairing a reworded ingredient (issue #1137), it just
// never surfaces it. This type is a render contract, not a Firestore document: it
// is never persisted, so there is no back-compat surface.
//
// PLAIN TYPES, NOT ZOD, AND THAT IS THE RULE RATHER THAN AN EXCEPTION TO IT
// (issue #973). CLAUDE.md's Zod conventions say validate at trust boundaries only.
// A diff is computed in-process by `diffRecipe` from two arguments and handed
// straight to `RecipeChangeSummary.svelte`: it never arrives from a client, a
// model or Firestore, and it is never written back to any of them. There is no
// boundary here, so there is nothing to validate — and a schema whose `.parse()`
// is never called is validation machinery that only reads as though it runs.
// Every declaration below was a `z.object` until #973; each one still carries the
// comment it had then, and none of them gained or lost a field in the conversion.
// `resolveSchedule.ts` and `totalDuration.ts` in the process module own their
// result types the same way, as does `processDiff.ts` beside them.

// A change on a required string field (title). `from !== to` by construction.
export interface RecipeFieldChange {
  from: string;
  to: string;
}

// A change on a nullable string field (description, notes, step note). null means
// "cleared"/"unset"; a null→string or string→null transition is a real change.
export interface NullableStringChange {
  from: string | null;
  to: string | null;
}

// A change on a nullable numeric metadata field (servings + the time fields).
export interface NullableNumberChange {
  from: number | null;
  to: number | null;
}

// One added or removed ingredient, item-level (flattened across groups). Ingredient
// identity for the summary is its `rawText`; `id` is carried for keying only.
export interface IngredientDiffEntry {
  id: string;
  rawText: string;
}

// An edited ingredient (same id reused, `rawText` reworded), keyed by id.
export interface IngredientChange {
  id: string;
  from: string;
  to: string;
}

// The ingredients section. Named rather than left inline (it had no `z.infer`
// alias before #973) so `RecipeDiff` names a type per section instead of carrying
// an anonymous shape.
export interface IngredientsDiff {
  added: IngredientDiffEntry[];
  removed: IngredientDiffEntry[];
  changed: IngredientChange[];
}

// A step's timer changing (added, removed, or re-timed). null = no timer.
export interface StepTimerChange {
  from: StepTimerDoc | null;
  to: StepTimerDoc | null;
}

// An added or removed step. `position` is the 1-based index (in the draft for an
// added step, in the existing recipe for a removed one) so the client can say
// "step 3". A positive integer by construction — it is an array index plus one —
// which is what the `z.number().int().positive()` it replaced asserted and never
// checked.
export interface StepDiffEntry {
  id: string;
  position: number;
  text: string;
}

// An edited step (same id reused, or same `text` matched by fallback). `position`
// is the 1-based index in the draft. Each of text/timer/note is present only when
// that facet changed; at least one is always present.
export interface StepChange {
  id: string;
  position: number;
  text?: RecipeFieldChange;
  timer?: StepTimerChange;
  note?: NullableStringChange;
}

// The steps section. Named for the same reason as `IngredientsDiff`.
export interface StepsDiff {
  added: StepDiffEntry[];
  removed: StepDiffEntry[];
  changed: StepChange[];
}

// A change to the phase strip (issue #1212). BOTH SIDES WHOLE, never a per-phase
// add/remove/change breakdown: the strip is one fact — a sequence — and a diff
// that reported a reorder as six row edits would bury the single question the
// review gate is asked ("did the timing change, and to what?"). An absent strip
// and an empty one are both `[]` here, the same conflation `recipePhaseTotals`
// and `reconcileRecipePhases` already make.
//
// UNLIKE ingredients and steps, a pure REORDER IS reported. The convention below
// omits a moved-but-unchanged ingredient because its position carries no meaning;
// a phase list is the order you do the work in, so moving `Bake` before `Prove`
// is a different plan for the cook even though no phase's own content moved.
export interface RecipePhasesChange {
  from: RecipePhase[];
  to: RecipePhase[];
}

// Per-field metadata changes. A field is present only when it changed.
//
// `phases` and `timingSummary` are the strip and the sentence written over it —
// two halves of one fact (`reconcileRecipePhases`), so they are reported as two
// fields and rendered as one card rather than merged here: the diff stays a
// faithful account of what moved and the summary decides how to say it.
export interface RecipeMetadataDiff {
  servings?: NullableNumberChange;
  // Deferred here until issue #1213's phase 5 stops the CF writers
  // (`recipeAmend.ts` and Refresh) from proposing these fields at all — while
  // they still do, the review gate needs a way to show the cook what changed
  // (PR #1231 review, blocking finding 2).
  totalTimeMinutes?: NullableNumberChange;
  prepTimeMinutes?: NullableNumberChange;
  cookTimeMinutes?: NullableNumberChange;
  phases?: RecipePhasesChange;
  timingSummary?: NullableStringChange;
}

// Tag set change. `added`/`removed` are the set difference (draft − existing and
// existing − draft), in first-seen order of their source list. Named for the same
// reason as `IngredientsDiff`.
export interface TagsDiff {
  added: string[];
  removed: string[];
}

// The full recipe diff. `ingredients`, `steps`, `metadata`, and `tags` are always
// present (with empty arrays / no per-field keys) so the render shape is stable;
// `title`/`description`/`notes` are present only when changed. `hasChanges` is the
// single no-op signal: false ⟺ every section is empty. Pure reorders with no
// content change are intentionally NOT reported (identity is by id then content,
// so a moved-but-unchanged item matches and is omitted) — add/remove/change
// clarity is the priority for the summary UX.
export interface RecipeDiff {
  hasChanges: boolean;
  title?: RecipeFieldChange;
  description?: NullableStringChange;
  notes?: NullableStringChange;
  ingredients: IngredientsDiff;
  steps: StepsDiff;
  metadata: RecipeMetadataDiff;
  tags: TagsDiff;
}
