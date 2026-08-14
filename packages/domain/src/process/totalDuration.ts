import type { ProcessStage, StageDuration } from '../schemas/index.js';

/** The span a duration covers, in minutes. A fixed duration is a degenerate span. */
export interface DurationRange {
  minMinutes: number;
  maxMinutes: number;
}

// A RANGE OUT, NEVER A COLLAPSED MIDPOINT. "This takes about six hours" is a
// different claim from "this takes five and a half to seven", and the second is
// what the recipe said. Flattening it here would be the same information loss the
// formula screen already stops and discloses for ingredient ranges — and worse,
// because nobody would be told.
//
// Stages with no duration contribute NOTHING to either end. That is the honest
// answer for "prove until doubled": the total is at least the timed stages, and
// how much more is precisely what nobody knows. It is not zero and it is not
// infinite, so the number simply does not include it.
function spanOf(duration: StageDuration): DurationRange {
  if (duration.kind === 'fixed') {
    return { minMinutes: duration.minutes, maxMinutes: duration.minutes };
  }
  // Defensive min/max rather than trusting the field order: a hand-edited stage
  // may have been typed "60 to 45", and the schema deliberately carries no refine
  // that would fail the whole document over it.
  return {
    minMinutes: Math.min(duration.minMinutes, duration.maxMinutes),
    maxMinutes: Math.max(duration.minMinutes, duration.maxMinutes),
  };
}

/**
 * How long the whole process takes, as a range.
 *
 * Sums every stage that has a duration — actives included, because the twenty
 * minutes spent shaping is twenty minutes the loaf is not in the oven. An empty
 * list, or a list where nothing is timed, totals `{ 0, 0 }`.
 */
export function totalDurationMinutes(stages: readonly ProcessStage[]): DurationRange {
  return stages.reduce<DurationRange>(
    (total, stage) => {
      if (stage.duration === null) return total;
      const span = spanOf(stage.duration);
      return {
        minMinutes: total.minMinutes + span.minMinutes,
        maxMinutes: total.maxMinutes + span.maxMinutes,
      };
    },
    { minMinutes: 0, maxMinutes: 0 },
  );
}
