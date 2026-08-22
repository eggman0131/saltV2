import type { RecipeKitEntryDoc, StepDoc } from '../../schemas/index.js';

// Which piece of kit each step is the one to REACH FOR (issue #882).
//
// The multi-step sibling of `firstUseByStep`, and deliberately a second query
// rather than a widening of that one. An ingredient has exactly one interesting
// moment — the step it enters the dish — so `firstUsedInStepId` is singular and
// right. A frying pan is not like that: it enters at step 3 and is still on the
// hob at step 9, and a mixing bowl gets used at 1, put down, and picked up again
// at 6. `kit[].stepIds` is plural for that reason, and this is what turns the
// plural back into something a method column can draw.
//
// THE CONTIGUOUS-RUN RULE, which is the whole point of the file: a tool is
// listed under a step only when it was NOT listed under the immediately
// preceding step in recipe order. So a pan used at steps 3,4,5,6,7 is drawn once,
// at 3 — the step it comes out of the cupboard — and a bowl used at 1 and again
// at 6 is drawn twice, because step 5 did not use it and it went back down. The
// naive rendering (a picture under every step that names the tool) turns a long
// method into a column of the same frying pan repeated seven times, which is not
// information; it is wallpaper the eye learns to skip.
//
// PURE (CLAUDE.md rule 1). This is derivation, not display: the same answer feeds
// the recipe page's method, the cook-mode deck and the guided step screen, and
// three copies of a run-detection rule would be three chances for those surfaces
// to disagree about when the pan comes out.

/**
 * Group a recipe's kit by the step it should be DRAWN at, under the
 * contiguous-run rule above.
 *
 * @param kit  The recipe's `kit` entries, in stored order.
 * @param steps The recipe's steps, in recipe order — the authority on both which
 *   step ids exist and what order they run in.
 * @returns A map from step id to the entries starting at that step. A step with
 *   nothing starting at it is absent from the map, exactly as in
 *   `firstUseByStep`, so a caller's `?? []` covers it.
 */
export function kitByStep(
  kit: readonly RecipeKitEntryDoc[],
  steps: readonly StepDoc[],
): Map<string, RecipeKitEntryDoc[]> {
  // Recipe order is the ONLY order that counts. `stepIds` comes off a document
  // an AI wrote, and nothing has ever promised it is sorted — resolving each id
  // to its index here means an out-of-order list still yields the same runs.
  const indexOfStep = new Map<string, number>();
  steps.forEach((step, i) => indexOfStep.set(step.id, i));

  const map = new Map<string, RecipeKitEntryDoc[]>();

  for (const entry of kit) {
    // A stale id — a step deleted after the kit was inferred — is dropped in
    // silence, the same rule guided plans already apply to an orphaned step note.
    // `sanitiseRecipeKit` cleans at write time, but a plain editor save that
    // deletes a step re-runs no inference, so the document genuinely does carry
    // ids pointing at nothing. Better a tool that quietly stops being mentioned
    // than one misattributed to whichever step happened to take that position.
    const indices = new Set<number>();
    for (const stepId of entry.stepIds) {
      const i = indexOfStep.get(stepId);
      if (i !== undefined) indices.add(i);
    }

    for (const i of [...indices].sort((a, b) => a - b)) {
      // The run rule in one line: this step starts a run iff the step before it
      // did not use the same tool. Index 0 always starts one — there is no
      // preceding step to have had it out already.
      if (indices.has(i - 1)) continue;
      const stepId = steps[i]!.id;
      const list = map.get(stepId);
      if (list) list.push(entry);
      else map.set(stepId, [entry]);
    }
  }

  return map;
}
