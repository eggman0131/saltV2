// What units a person READS, stated once (issue #934).
//
// Two prompts stated this and they disagreed. `CHEF_SYSTEM_BASE` told the chef to
// write `"½ tsp salt (3 g)"`; `parseRecipeIngredients` produces
// `"2g whole black peppercorns (1 tsp)"` and the read view renders it that way.
// Both cannot be right, and neither could see the other — a policy written twice
// in different words shares no substring, so nothing greps it.
//
// THE BOUNDARY THIS CONSTANT DOES NOT CROSS, and it is the important half.
// There are two unit rules in this codebase and they are not the same rule:
//
//   * THIS one is READER-FACING. It governs prose a person reads and the
//     `displayText` bracket the read view renders. Its consumers are
//     `apps/cloud-functions/src/flows/chefChat.ts` and
//     `apps/cloud-functions/src/flows/parseRecipeIngredients.ts`.
//   * `MEASURE_RULES` (`apps/cloud-functions/src/flows/recipeFieldRules.ts`) is
//     PIPELINE-FACING. It governs the `rawText` the librarian and the extractors
//     write, and it deliberately says the OPPOSITE about a spoon measure: leave
//     it exactly as the source wrote it, do NOT convert it, because the stage
//     that converts it is `parseRecipeIngredients` and converting early deletes
//     the bracket rather than moving it.
//
// Interpolating this constant into `MEASURE_RULES` would be the #785/#784 failure
// in a new register — a rule that is right at one boundary silently applied at
// another — and that is precisely how imports lost their spoon measures once
// before. Read the `MEASURE_RULES` header before deciding otherwise.
//
// WHAT "3 tbsp or less" IS ENFORCED BY, precisely: the `displayText` bullet of
// `parseRecipeIngredients`' system prompt, which is asserted to carry the bound
// in `apps/cloud-functions/tests/flows/parseRecipeIngredients.test.ts` — AND, as
// of #1196, `clampSpoonMeasureDisplayText` below, which the flow runs over every
// `displayText` the model returns. So the honest claim widens: the cap is ASKED
// FOR at every site that can produce a bracket, AND a bracket the model returns
// above it is nulled deterministically before the ingredient is stored. What is
// still not proven is that the model reaches for the bracket shape at all — that
// half stays a prompt ask, pinned only by the staging round-trip in
// `apps/cloud-functions/tests/flows/unitPolicy.test.ts`.

/**
 * The one number "3 tbsp or less" means, shared by the prompt bullets below and
 * the mechanical clamp (issue #1196). Named so a change to the bound is one
 * edit, not a search for a paraphrase — `parseRecipeIngredients.ts` interpolates
 * this into every bullet that states the bound, and the value is never
 * hand-copied a second time as a literal `3`.
 */
export const SPOON_MEASURE_CAP_TBSP = 3;

/**
 * The reader-facing unit policy: metric or a count, with a small spoon measure
 * permitted in brackets AFTER the metric value.
 *
 * Carries no bullet, no shouted label and no newline, so it interpolates
 * mid-paragraph into the chef's conversational prompt and mid-bullet into the
 * parser's markdown field list. Same two-register shape as
 * `ONE_OPERATION_PER_STEP_PRINCIPLE` — see `stepPolicy.ts`.
 */
export const READER_UNIT_PRINCIPLE = `Amounts a person reads are metric or a count: grams for anything dry — even when it was measured in spoons — millilitres for a liquid, or a plain count of the thing as it is bought. A spoon measure of ${SPOON_MEASURE_CAP_TBSP} tbsp or less may be carried alongside the metric value, in brackets AFTER it: "3 g salt (½ tsp)", "15 ml oil (1 tbsp)". The metric value always comes first, never the spoon, and anything above ${SPOON_MEASURE_CAP_TBSP} tbsp gets no bracket at all.`;

// ─── Mechanical enforcement of the cap (issue #1196) ────────────────────────
//
// Everything above this line only ASKS a model for the cap. The prose is not
// enforcement, and cannot be — a prompt bullet is advice a model can ignore or
// misapply. `clampSpoonMeasureDisplayText` is the deterministic backstop:
// `parseRecipeIngredients` runs every `displayText` it gets back through this
// after generation, so a bracket over the cap cannot reach a stored ingredient
// even when the model ignores the bullet above.
//
// It recognises only the shapes the prompt asks the model to use for a spoon
// measure — a plain or unicode-fraction number, or a "low-high" range of
// either, immediately followed by "tsp"/"tbsp" — and leaves every other
// `displayText` (a gram estimate, a friendly count, `null`) untouched: this is
// a cap on spoon measures specifically, not a general `displayText` validator.

const SPOON_FRACTION_GLYPHS: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};

const SPOON_UNIT_TBSP_FACTOR: Record<'tsp' | 'tbsp', number> = { tsp: 1 / 3, tbsp: 1 };

const SPOON_GLYPH_CLASS = '½⅓⅔¼¾⅛⅜⅝⅞';
const SPOON_NUMBER_SRC = `[\\d.]+[${SPOON_GLYPH_CLASS}]?|[${SPOON_GLYPH_CLASS}]`;
const SPOON_MEASURE_PATTERN = new RegExp(
  `^(${SPOON_NUMBER_SRC})\\s*(?:[-–]\\s*(${SPOON_NUMBER_SRC})\\s*)?(tsp|tbsp)$`,
  'i',
);

function parseSpoonNumber(raw: string): number | null {
  const fractionMatch = new RegExp(`^(\\d+)?([${SPOON_GLYPH_CLASS}])$`).exec(raw);
  if (fractionMatch) {
    // Group 2 is a mandatory capture (`(...)`, not `(...)?`) — present whenever
    // `fractionMatch` is non-null, so this can only fail if the glyph class
    // above is edited without updating `SPOON_FRACTION_GLYPHS` to match.
    const glyph = fractionMatch[2]!;
    const whole = fractionMatch[1] ? Number(fractionMatch[1]) : 0;
    return whole + SPOON_FRACTION_GLYPHS[glyph]!;
  }
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
}

/** The tbsp-equivalent of a spoon-measure `displayText`, or `null` if it is not one. */
function spoonMeasureTbspEquivalent(displayText: string): number | null {
  const match = SPOON_MEASURE_PATTERN.exec(displayText.trim());
  if (!match) return null;
  // Groups 1 and 3 (low, unit) are mandatory captures in SPOON_MEASURE_PATTERN;
  // only group 2 (the range's high end) is optional. Non-null asserted rather
  // than re-guarded — a match already proves they matched something.
  const lowRaw = match[1]!;
  const highRaw = match[2];
  const unitRaw = match[3]!;
  const low = parseSpoonNumber(lowRaw);
  const high = highRaw ? parseSpoonNumber(highRaw) : low;
  if (low === null || high === null) return null;
  const unit = unitRaw.toLowerCase() as 'tsp' | 'tbsp';
  return Math.max(low, high) * SPOON_UNIT_TBSP_FACTOR[unit];
}

/**
 * Nulls a spoon-measure `displayText` over `SPOON_MEASURE_CAP_TBSP`; returns
 * every other `displayText` — a non-spoon measure, `null`, or one already
 * within the cap — unchanged.
 */
export function clampSpoonMeasureDisplayText(displayText: string | null): string | null {
  if (displayText === null) return null;
  const tbsp = spoonMeasureTbspEquivalent(displayText);
  return tbsp !== null && tbsp > SPOON_MEASURE_CAP_TBSP ? null : displayText;
}
