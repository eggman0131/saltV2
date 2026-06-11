// An ingredient quantity. Three shapes (issue #179):
//   - single: a plain numeric amount, e.g. "2", "0.5", "200" (grams).
//   - range:  a low–high amount, e.g. "2–3".
//   - mixed:  a whole number plus an exact fraction, e.g. "1 ½" or a bare "½".
//
// `mixed` stores the fraction as { whole, numerator, denominator } rather than a
// decimal so "1 ½" round-trips exactly instead of collapsing to 1.5 (Phase 1
// inline decision: preserve exact fractions). A bare fraction is whole = 0.

export interface SingleQuantity {
  readonly type: 'single';
  readonly value: number;
}

export interface RangeQuantity {
  readonly type: 'range';
  readonly min: number;
  readonly max: number;
}

export interface MixedQuantity {
  readonly type: 'mixed';
  readonly whole: number;
  readonly numerator: number;
  readonly denominator: number;
}

export type Quantity = SingleQuantity | RangeQuantity | MixedQuantity;
