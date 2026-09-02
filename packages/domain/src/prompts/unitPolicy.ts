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
// in `apps/cloud-functions/tests/flows/parseRecipeIngredients.test.ts`. It is a
// prompt instruction to a model, not a post-parse clamp — so the honest claim is
// that the cap is ASKED FOR at every site that can produce a bracket, not that no
// bracket above 3 tbsp can ever be stored. Nothing downstream re-checks it.

/**
 * The reader-facing unit policy: metric or a count, with a small spoon measure
 * permitted in brackets AFTER the metric value.
 *
 * Carries no bullet, no shouted label and no newline, so it interpolates
 * mid-paragraph into the chef's conversational prompt and mid-bullet into the
 * parser's markdown field list. Same two-register shape as
 * `ONE_OPERATION_PER_STEP_PRINCIPLE` — see `stepPolicy.ts`.
 */
export const READER_UNIT_PRINCIPLE =
  'Amounts a person reads are metric or a count: grams for anything dry — even when it was measured in spoons — millilitres for a liquid, or a plain count of the thing as it is bought. A spoon measure of 3 tbsp or less may be carried alongside the metric value, in brackets AFTER it: "3 g salt (½ tsp)", "15 ml oil (1 tbsp)". The metric value always comes first, never the spoon, and anything above 3 tbsp gets no bracket at all.';
