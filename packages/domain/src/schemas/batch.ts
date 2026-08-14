import { z } from 'zod';
import { ProcessStageSchema } from './process.js';

// Batch document schema (issue #812, phase 1 of epic #778) — ONE RUN of a formula
// at `batches/{batchId}`. Family-shared (no `ownerUid`), a random UUID id minted by
// `batchService`, whole-document last-write-wins.
//
// A batch is NOT a cook session and is deliberately not built on one: wrong
// ownership (a crock belongs to the household, not to whoever tapped Start), wrong
// lifetime (weeks or months, against one evening), wrong sharing. It is the object
// opened day to day; the formula is opened once a month.
//
// ─── EVERYTHING HERE IS FROZEN, AND THAT IS THE POINT ───────────────────────────
//
// The formula may be re-mapped tomorrow, the recipe retitled, an ingredient
// renamed, the whole dish deleted. A batch that read through to any of those would
// have its log rewritten under it — "batch nine at 78% hydration" would silently
// become whatever batch ten was mapped at, which makes the log worthless exactly
// when it is worth having. So the run freezes:
//
//   • the resolved quantities — ingredient id, LABEL, percent and grams;
//   • the resolved totals from the solve;
//   • the resolved schedule, stage by stage, with planned and actual times;
//   • the recipe's title;
//   • the worded rationale for the schedule (phase 2 authors it; phase 1 writes
//     null).
//
// LABELS AS WELL AS NUMBERS. "841 g of ing-7f3a" is not a record of anything a
// person can read a year later, so the recipe's own `rawText` is copied onto the
// quantity at freeze. A renamed or deleted recipe leaves the log intact.
//
// There is NO re-scaling and NO re-scheduling of a running batch, and no route to
// one anywhere in this feature. Freezing exists precisely to prevent versions: a
// batch you can rescale is a batch whose log no longer says what you did.
//
// Timestamps are ISO-8601 STRINGS throughout, matching `cookSession.endsAt` and
// `guidedPlan.createdAt` — not Firestore Timestamps (which would leak the SDK's
// type into the domain) and not epoch numbers (unreadable in the console).

// ─── The run's state ────────────────────────────────────────────────────────────
//
// TWO states, and the absences are deliberate.
//
// There is no `finished`: "every stage is done" is already answerable from the
// stages themselves (`currentStage` returns null), and a distinct terminal state
// only earns its place when something OTHER than the stage list decides it — a
// verdict, a yield, an observation that the cure hit 35%. That is phase 04's, and
// adding the literal here today would be a state nothing sets and every reader has
// to handle. Adding it later costs one line: `batches` is greenfield, and a widened
// enum parses every document already written.
//
// There is no `paused` either, for the same reason — nothing pauses a batch, and
// the honest way to stop one is to abandon it.
export const BatchStateSchema = z.enum(['running', 'abandoned']);

// ─── The frozen quantities ──────────────────────────────────────────────────────
//
// One entry per solved component, in the formula's own order. `percent` rides
// along beside `grams` because the percentage is what the baker reasons in ("70%
// hydration") and re-deriving it from grams later would depend on a basis this
// document does not carry.
export const BatchQuantitySchema = z.object({
  // FK into the recipe's `ingredients[].id` — kept so a live recipe can still be
  // joined against, never relied on for display.
  ingredientId: z.string(),
  // The recipe's `rawText` AS A LABEL, copied at freeze. "Strong white flour".
  // Empty when the ingredient had already left the recipe by the time the batch was
  // started: an empty label is honest, an invented one is not.
  label: z.string(),
  // Of the basis, as the formula stated it.
  percent: z.number().nonnegative(),
  // What you weigh, through the formula module's one rounding authority.
  grams: z.number().nonnegative(),
});

// What the shape divides into, echoed from the solve so a batch can still say "12
// × 120 g rolls" with no formula in hand. Null for a basis-driven solve: weighing
// the meat says nothing about how many of anything you end up with.
export const BatchUnitsSchema = z.object({
  label: z.string(),
  count: z.number().int().positive(),
  unitDoughGrams: z.number().positive(),
  // After bake loss — what actually comes out of the oven.
  bakedUnitGrams: z.number().nonnegative(),
});

// The solve's headline figures, frozen. Rounded only: the exact floats exist so
// nothing re-derives and re-rounds mid-calculation, and there is no calculation
// left once the batch is written.
export const BatchTotalsSchema = z.object({
  basisGrams: z.number().nonnegative(),
  totalGrams: z.number().nonnegative(),
  usableGrams: z.number().nonnegative(),
  units: BatchUnitsSchema.nullable(),
});

// ─── The frozen schedule ────────────────────────────────────────────────────────
//
// A stage as the process declared it, PLUS where it lands on a clock. Extending
// `ProcessStageSchema` rather than restating four fields is what keeps the recipe's
// own claim intact on the run: a prove the recipe wrote as "45–60 minutes" still
// reads as 45–60 here, beside the single time the schedule had to commit to. See
// `resolveSchedule` for which end of a range that is, and why.
//
// PLANNED versus ACTUAL is the whole state machine. `planned*` is what the schedule
// said when it was resolved and is re-timed forward every time a stage is marked
// done early or late; `actual*` is what happened, and only ever what was observed —
// nothing here back-fills an actual from a planned time.
export const BatchStageSchema = ProcessStageSchema.extend({
  plannedStartAt: z.string(),
  plannedEndAt: z.string(),
  // Null until observed. Stamped on the FOLLOWING stage when one is advanced (its
  // predecessor ending is it starting); the first stage's stays null in this phase,
  // because nothing yet observes a beginning — the field is where a later "I
  // actually started at 06:40" lands.
  actualStartAt: z.string().nullable(),
  // Null until the stage is marked done. This — not a `done` boolean — is what
  // says a stage is finished: one field, carrying both the fact and the time.
  actualEndAt: z.string().nullable(),
});

export const BatchSchema = z.object({
  // Random UUID, equal to the doc id at `batches/{batchId}`. RANDOM, not derived
  // from the recipe: a recipe has many runs, which is the entire difference between
  // this collection and `formulas/{recipeId}`.
  id: z.string(),
  schemaVersion: z.literal(1),
  // FK to the recipe. May dangle — see `recipeTitle`.
  recipeId: z.string(),
  // The recipe's title, frozen. The log survives the dish being renamed or deleted.
  recipeTitle: z.string(),
  state: BatchStateSchema,
  quantities: z.array(BatchQuantitySchema),
  totals: BatchTotalsSchema,
  stages: z.array(BatchStageSchema),
  // The schedule's worded reasoning, as the proposal flow put it ("the retard is
  // long because you want the bake at 07:30, so the counter prove is cut to 20
  // minutes"). NULLABLE and always null in phase 1: nothing authors prose yet, and
  // a schedule resolved by pure arithmetic has no opinion to record.
  rationale: z.string().nullable(),
  createdAt: z.string(),
  // The ordering token for the write path's stale-echo guard, and the only reason
  // this document carries timestamps at all where `formulas` does not.
  updatedAt: z.string(),
});

export type BatchState = z.infer<typeof BatchStateSchema>;
export type BatchQuantityDoc = z.infer<typeof BatchQuantitySchema>;
export type BatchUnitsDoc = z.infer<typeof BatchUnitsSchema>;
export type BatchTotalsDoc = z.infer<typeof BatchTotalsSchema>;
export type BatchStageDoc = z.infer<typeof BatchStageSchema>;
export type BatchDoc = z.infer<typeof BatchSchema>;
