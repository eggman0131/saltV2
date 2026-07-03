import type {
  SingleQuantityDoc,
  RangeQuantityDoc,
  MixedQuantityDoc,
  QuantityDoc,
} from '../../schemas/recipe.js';

// An ingredient quantity. Three shapes (issue #179):
//   - single: a plain numeric amount, e.g. "2", "0.5", "200" (grams).
//   - range:  a low–high amount, e.g. "2–3".
//   - mixed:  a whole number plus an exact fraction, e.g. "1 ½" or a bare "½".
//
// `mixed` stores the fraction as { whole, numerator, denominator } rather than a
// decimal so "1 ½" round-trips exactly instead of collapsing to 1.5 (Phase 1
// inline decision: preserve exact fractions). A bare fraction is whole = 0.
//
// Schema-first (issue #417): these are the inferred schema types from
// `@salt/domain/schemas` — `QuantitySchema` & co. are the single source of truth.
// The entity aliases stay so the recipe module's public surface is unchanged.
export type SingleQuantity = SingleQuantityDoc;
export type RangeQuantity = RangeQuantityDoc;
export type MixedQuantity = MixedQuantityDoc;
export type Quantity = QuantityDoc;
