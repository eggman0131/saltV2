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

/** "45 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * What the recipe ACTUALLY SAID a stage takes — never the single number the
 * schedule had to commit to.
 *
 * A range stays a range ("45 min – 1 h"). `resolveSchedule` places it at its long
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
