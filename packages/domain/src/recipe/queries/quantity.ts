import type { Quantity } from '../entities/Quantity.js';

// A parsed ingredient quantity reduced to ONE number (issue #917).
//
// This is the only numeric reduction of a `Quantity` in the codebase, and it is
// deliberately shared: the shopping list and the formula mapping screen used to
// hold one each — `q.min` in `recipeService`, the midpoint in
// `formula/gramsFromParsed` — so the same "2–3 tbsp" bought 30 ml and baked at
// 37.5 ml. Rendering a range for a human to read ("30–45") is a different job and
// stays in the component that renders it; this is the numeric answer, and there
// is one of it.
//
// ─── Which number a RANGE reduces to: THE TOP ──────────────────────────────────
//
// A range collapses to `max`. The reasoning, in the order it decides the case:
//
//   • The shopping list exists so the household can cook the dish. The two ways
//     of being wrong are not symmetric: too little of an ingredient is a dinner
//     that cannot be made, too much is a bit left in the cupboard. The bottom of
//     the range — the previous behaviour — is the one figure guaranteed to be
//     short whenever the cook reads the recipe generously.
//   • The top of the range is a number the recipe ACTUALLY STATES. A midpoint is
//     not: nobody wrote 37.5, and printing it back with a confidence the source
//     never had is the information loss, not a defence against it. This is the
//     same argument `process/resolveSchedule.ts` already made when it scheduled a
//     "45–60 minute" prove at 60 rather than 52.5 — the two range-bearing fields
//     now agree on why, even though they are different fields.
//   • A formula can survive the choice where the shopping list cannot. The
//     mapping screen discloses every range row with the exact gram figure it took
//     and lets the baker type a different one; a shopping list written from a
//     range gets no such moment. So the consumer with no escape hatch decides,
//     and the consumer with one is disclosed to.
//
// What a range is NOT reduced to, and why not to "fix" it back:
//   • `min` under-buys, per the first point.
//   • the midpoint invents a figure, per the second.
//
// `single` is itself; `mixed` is the exact fraction evaluated ("1 ½" → 1.5).
// `MixedQuantitySchema` pins `denominator` positive, so this cannot divide by
// zero on a parsed document; a caller laundering an unvalidated shape is
// responsible for the finite check it already owes itself.
export function quantityToNumber(quantity: Quantity): number {
  switch (quantity.type) {
    case 'single':
      return quantity.value;
    case 'range':
      return quantity.max;
    case 'mixed':
      return quantity.whole + quantity.numerator / quantity.denominator;
  }
}
