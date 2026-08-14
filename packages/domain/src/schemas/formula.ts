import { z } from 'zod';

// Formula document shape (issue #782, epic #778) — composition as ratios against
// a declared basis. Baker's percentage is the general case: the basis is the set
// of ingredients whose combined weight is 100% (the flours, the vegetables, the
// green weight of the meat) and everything else is a percentage of that total.
//
// PERCENT IS THE SOURCE OF TRUTH; GRAMS ARE DERIVED. Nothing here stores a gram
// figure — the recipe's `ingredients[]` remains "the resolved projection at the
// formula's reference yield" (docs/formulas-schedules-batches.md). Storing both
// would let them drift.
//
// Stored at `formulas/{recipeId}` since issue #806 (family-shared, deterministic
// id, no ownerUid), written by exactly one path — `formulaService.saveFormula` in
// the PWA. The SHAPE is unchanged from #782, which landed it headless because the
// pure functions in `packages/domain/src/formula/` are typed against it.
//
// Deliberately no `createdAt`/`updatedAt`: there is no ordering token here and
// nothing needs one. Document-level LWW is the whole conflict story, exactly as
// it is for `mealPlans/{startDate}`.

// How an ml figure became grams, recorded on the component that needed the
// conversion rather than looked up per environment. Named classes (not a raw
// number) so the provenance survives re-derivation, and not a canon-id table
// because canon ids are minted per environment and would be empty everywhere but
// one. Values live in `formula/density.ts`.
export const DensityClassSchema = z.enum(['waterLike', 'oil', 'syrup']);

export const FormulaComponentSchema = z.object({
  // FK into the recipe's `ingredients[].id`.
  ingredientId: z.string(),
  // Of the BASIS total, not of the whole. Basis members' own percentages sum to
  // 100 by definition, so a 176.4% grand total is normal and correct.
  percent: z.number().nonnegative(),
  inBasis: z.boolean(),
  density: DensityClassSchema.optional(),
  // The bound seam. Declared per component and enforced generically by the
  // solve, which REFUSES rather than extrapolates — phase 04's nitrite limits are
  // the load-bearing customer, and that must not be a decision a screen can be
  // talked out of. No bound VALUE is set anywhere in this phase.
  minPercent: z.number().nonnegative().optional(),
  maxPercent: z.number().positive().optional(),
});

// A shape the dough is divided into. `unitDoughGrams` is DOUGH weight, never
// baked weight — "120 g rolls" is what you scale onto the bench. The baked figure
// is derived through `bakeLossPercent` and shown alongside so nobody is surprised.
export const UnitShapeSchema = z.object({
  label: z.string(), // "900 g tin loaf", "120 g roll"
  count: z.number().int().positive(),
  unitDoughGrams: z.number().positive(),
  bakeLossPercent: z.number().min(0).max(100),
});

// The yield the formula's percentages were derived at — and, passed to
// `solveFormula`, any yield you want them resolved at instead. Both directions of
// the same equation, deliberately one type so neither is privileged:
//   - `target` (bread): "12 × 120 g rolls" — the output is known, solve for basis.
//   - `basis` (ferments, cures): you unwrap the meat, it weighs 2.4 kg.
export const ReferenceYieldSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('target'), shape: UnitShapeSchema }),
  z.object({ kind: z.literal('basis'), grams: z.number().positive() }),
]);

export const FormulaSchema = z.object({
  // Equal to the doc id at `formulas/{recipeId}` when this is eventually stored,
  // the same way `ShoppingDaySchema.date` is.
  recipeId: z.string(),
  components: z.array(FormulaComponentSchema),
  referenceYield: ReferenceYieldSchema,
  // What stays in the bowl and on the bench, as an allowance ADDED to the dough
  // you need (×1.03 at 3%), not as a divisor. See `solveFormula` for why this
  // direction, and note the two solve directions are exact inverses of each other
  // under it.
  handlingLossPercent: z.number().min(0).max(100).default(0),
  schemaVersion: z.literal(1).default(1),
});

export type DensityClass = z.infer<typeof DensityClassSchema>;
export type FormulaComponent = z.infer<typeof FormulaComponentSchema>;
export type UnitShape = z.infer<typeof UnitShapeSchema>;
export type ReferenceYield = z.infer<typeof ReferenceYieldSchema>;
export type Formula = z.infer<typeof FormulaSchema>;
