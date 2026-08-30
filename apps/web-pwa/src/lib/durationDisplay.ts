import type { StageDuration } from '@salt/domain/schemas';

// How a LENGTH OF TIME reads (epic #778) — one vocabulary for every surface in the
// formula/schedule/batch feature, so the formula screen, the proposal review and
// the two batch screens can never disagree about what "90 minutes" is called.
//
// This module exists because the rule its predecessor wrote down came true.
// `routes/batches/batchDisplay.ts` carried a copy of `formatMinutes` and said
// plainly that duplicating a five-line formatter beat coupling two route folders,
// "if a third surface wants it, that is the moment it earns a home". #812 phase 2
// added the third surface — the proposal review — and the choice was then between
// a third copy and one route folder reaching into another's display helpers.
// Neither is right, so the formatters moved here and the duplicate on
// `FormulaPage` went with them.
//
// NOTHING HERE COMPUTES ANYTHING. These take a number the domain already decided
// and choose words for it. The moment one of them adds a minute or rounds a gram,
// a screen has started re-deriving what the freeze exists to pin down.
//
// It happened once more before it stopped: the recipe page grew its OWN
// `formatMinutes` (`routes/recipes/recipeDuration.ts`, issue #878) rather than
// import this one, and the two then disagreed about what ninety minutes is
// called — `1 hr 30 min` on the recipe page, `1 h 30 min` on the formula,
// schedule and batch screens. Issue #933 retired the fork onto the recipe page's
// implementation, and this is now the only one. `hr` is what the whole app says.
// `tests/sharedHelperGuard.test.ts` walks the whole of `src` and fails on a
// second declaration, which is what a comment could not do.

const MINUTES_PER_HOUR = 60;

/**
 * A duration in minutes, written the way a cook would say it.
 *
 * - Under an hour stays in minutes — `40` → `40 min`. This is the range where
 *   minutes ARE the unit a cook thinks in ("give it twenty").
 * - An hour and over becomes hours, with the leftover minutes when there are
 *   any — `60` → `1 hr`, `75` → `1 hr 15 min`, `90` → `1 hr 30 min`,
 *   `360` → `6 hr`, `1440` → `24 hr`.
 *
 * The switch is at 60 because it is the only boundary that needs no explanation:
 * one rule, one threshold, and no band in the middle where the same dish reads
 * two ways depending on which field you are looking at.
 *
 * **No days.** A 36-hour cure is `36 hr`, not `1 day 12 hr`. A cook plans a long
 * ferment in hours — "twenty-four hours in the fridge" — and days would force a
 * two-unit phrase to say something one unit already says clearly.
 *
 * **`hr` and `min`, never pluralised.** They are unit abbreviations, matching the
 * `min` the app has always used, so `1 hr` and `6 hr` line up as a column of
 * chips rather than jittering between two spellings.
 *
 * ROUND FIRST, THEN SPLIT — and that ordering is the whole of what the retired
 * copy got wrong. Taking `Math.floor(m / 60)` and `Math.round(m % 60)` on the raw
 * input rendered `59.6` as `60 min` (the hour branch was never reached), `NaN` as
 * `NaN h NaN min`, and `-5` as `-1 h -5 min`. The schema types these as `number`
 * and an imported recipe can carry a fractional one, so all three were reachable.
 * Anything non-finite or at or below zero is `0 min`, which is the honest
 * rendering of a nonsense value and never a thrown error on a page whose only job
 * is to display it.
 */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  if (!Number.isFinite(whole) || whole <= 0) return '0 min';
  if (whole < MINUTES_PER_HOUR) return `${whole} min`;

  const hours = Math.floor(whole / MINUTES_PER_HOUR);
  const rest = whole % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * What the recipe ACTUALLY SAID a stage takes — never the single number the
 * schedule had to commit to.
 *
 * A range stays a range ("45 min – 1 hr"). `resolveSchedule` places it at its long
 * end and the frozen stage keeps the whole `duration` precisely so a screen can
 * show both; collapsing it here would throw away the honesty the schema went out
 * of its way to preserve.
 *
 * Null for an observational stage ("until doubled"), which has no length at all —
 * the caller decides how to word that, because a batch screen and a review sheet
 * say it differently.
 *
 * The min/max pair is defensive rather than decorative: a hand-edited stage may
 * have been typed "60 to 45", and `StageDurationSchema` deliberately carries no
 * refine that would fail a whole document over it.
 */
export function formatStatedDuration(duration: StageDuration | null): string | null {
  if (duration === null) return null;
  if (duration.kind === 'fixed') return formatMinutes(duration.minutes);
  const low = Math.min(duration.minMinutes, duration.maxMinutes);
  const high = Math.max(duration.minMinutes, duration.maxMinutes);
  return low === high ? formatMinutes(low) : `${formatMinutes(low)} – ${formatMinutes(high)}`;
}
