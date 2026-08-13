// Why a derivation or a solve could not produce numbers (issue #782).
//
// A discriminated failure, never a throw: unsatisfiable input arrives from a
// human editing percentages, so it is ordinary flow rather than a programmer
// error. Every variant carries what a caller needs to say something useful, and
// `boundViolation` in particular carries enough for a caller to RE-PROPOSE rather
// than treat the bound as a dead end — a yeast rail catches an absurd suggestion
// and asks for another; a nitrite bound is a wall.

export type BoundViolation = {
  ingredientId: string;
  percent: number;
  // Which side was hit. Both bounds are reported when declared, so a caller can
  // show the window it missed rather than just the edge.
  bound: 'min' | 'max';
  minPercent?: number;
  maxPercent?: number;
};

export type FormulaFailure =
  // Nothing to scale.
  | { kind: 'emptyFormula' }
  // No component is marked `inBasis`, or the basis members weigh nothing. There
  // is no 100% to be a percentage of, so no figure can be produced.
  | { kind: 'noBasis' }
  // Basis members must sum to 100% — that is what "basis" means. Off by more than
  // `BASIS_PERCENT_TOLERANCE` and every addition's percentage means something
  // else, so the solve refuses instead of quietly renormalising someone's edit.
  | { kind: 'basisNotNormalised'; sumPercent: number }
  // A gram figure that cannot start a derivation: zero, negative, or non-finite.
  // An ingredient with no amount is not a component at all — see `gramsFromParsed`.
  | { kind: 'invalidAmount'; ingredientId: string; grams: number }
  | { kind: 'boundViolation'; violations: BoundViolation[] }
  // A yield that cannot be resolved into positive, finite weights.
  | { kind: 'unsolvableYield'; detail: string };
