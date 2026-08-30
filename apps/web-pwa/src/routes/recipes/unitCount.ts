// How many units a shape declares (issues #806, #812).
//
// PAGE-LOCAL on purpose, in the shape `cookTimerDuration.ts` establishes: this
// is how a box on the formula screen and a box on the bake sheet read a number
// a human typed, not a rule about what a unit shape IS. It lives in its own
// module only so it can be unit tested without mounting either component.
//
// Route-local rather than in `lib/`, deliberately: both consumers are in this
// folder, and `lib/` is for rules a `.ts` service also needs (issue #1055).

/**
 * The declared count, or nothing.
 *
 * Stricter than the formula page's own `parsePositiveNumber`, and the extra
 * clause is the interesting one: `UnitShapeSchema.count` is
 * `z.number().int().positive()` (`packages/domain/src/schemas/formula.ts:51`,
 * `batch.ts:81`), so two and a half loaves is not a lenient input to be rounded
 * — it is a document the schema would refuse. Rejecting it here is what keeps
 * Save disabled rather than letting an invalid shape be built.
 *
 * Nothing rather than a default: a half-typed declaration is not a shape with a
 * gap filled in, it is no declaration yet, and the same `shape === null` that
 * has always disabled Save covers it without a second rule.
 */
export function parseUnitCount(text: string): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}
