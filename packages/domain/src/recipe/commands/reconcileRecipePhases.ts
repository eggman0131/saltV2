import type { RecipePhase } from '../entities/Recipe.js';

// The one merge of a freshly-returned phase strip against what is already
// stored (issue #1122 review — PR #1201, blocking 1 & 2).
//
// A strip and its one-line summary are TWO HALVES OF ONE FACT — "here is the
// timing" — not two independent optional fields. Before this existed,
// `assembleRecipeDraft` and `onRecipeWritten` each fell each field back to the
// base recipe on its own, which let a fresh strip land under a stale sentence
// (or the reverse): a returned `phases` with no returned `timingSummary` paired
// the NEW three-block strip with the OLD prose describing a different one, and
// `onRecipeWritten` went further and had no fallback for `phases` at all — an
// estimate that returned three good numbers but omitted the strip erased a
// stored one outright, on a re-estimate the backfill would then never repeat
// (`timesEstimatedAt` is stamped in the same write).
//
// Pure, no I/O, no clock (CLAUDE.md Rule 1).

/** A recipe's phase strip and the sentence written over it. */
export interface RecipePhaseStrip {
  readonly phases: RecipePhase[];
  readonly timingSummary: string | null;
}

/**
 * Merge a model's timing response with what a recipe already has, keeping the
 * strip and its summary moving TOGETHER.
 *
 * The model answered iff `raw.phases` is non-empty — an explicit empty array
 * and an omitted key mean the same thing here (neither authoring path nor the
 * re-estimator distinguishes "asked and got nothing" from "forgot to ask"), and
 * an empty strip is not itself a fact worth stating over a real one.
 *
 *  - **Answered:** take BOTH fields from `raw`. A `timingSummary` the model left
 *    out stays `null` rather than borrowing the base's sentence — `null` is a
 *    real answer ("nothing worth a sentence"), not a gap to fill.
 *  - **Not answered:** take BOTH fields from `base` (or the strip's own empty
 *    default when there is no base — a fresh draft has nothing to protect). A
 *    hand-corrected or previously-estimated strip is not evidence of nothing,
 *    so it is carried forward untouched rather than erased by unrelated work.
 *
 * Named for what it returns, not for either call site: `assembleRecipeDraft`
 * (chat authoring, both imports, an edit-mode amend) and `onRecipeWritten`'s
 * re-estimate branch both answer the identical question and must agree.
 */
export function reconcileRecipePhases(
  raw: Readonly<{
    phases?: RecipePhase[] | undefined;
    timingSummary?: string | null | undefined;
  }>,
  base: Readonly<{
    phases?: RecipePhase[] | undefined;
    timingSummary?: string | null | undefined;
  }> | null,
): RecipePhaseStrip {
  if (raw.phases !== undefined && raw.phases.length > 0) {
    return { phases: raw.phases, timingSummary: raw.timingSummary ?? null };
  }
  return {
    phases: base?.phases ?? [],
    timingSummary: base?.timingSummary ?? null,
  };
}
