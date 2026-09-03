import { recipePhaseTotals, type Recipe } from '@salt/domain';
import { formatMinutes } from '../../lib/durationDisplay.js';

// "How long does this take?", asked by a surface that has to show ONE number
// (issue #1122).
//
// Five places ask it — the recipe page's component rows, the edit page's, the
// recipe list's chip, the list's Quickest sort and the meal cook plan's per-dish
// line — and #1122 exists because they were each answering it from a different
// stored field. One function, so they cannot drift back apart (#1055).
//
// EVERY SURFACE NOW GIVES THE SAME ANSWER, with no fallback under it (issue
// #1213). While the migration ran, each of the five kept its own fallback to
// whichever of prep / cook / total it had always shown, and this file was
// deliberately the smallest thing they shared. Those three fields are read by
// nothing now, so what is left is the whole answer: the phase sum, or `null`
// because the recipe states no timing at all.
//
// `componentTimeLabel` below is the one piece of WORDING that lives here (issues
// #1212, #1208's third bullet). It is not a general label: it is the COMPONENT
// ROW's, and the recipe page's rows and the edit page's rows are the same row on
// two screens — the two copies were byte-for-byte identical, and a rule stated
// twice is a rule that can disagree with itself. The list chip and the cook plan
// keep their own words because they genuinely say different things.

/**
 * A recipe's elapsed time from its phase strip, or `null` when it has no strip.
 *
 * `hasPhases` rather than `elapsedMinutes > 0`: a strip a cook has zeroed by hand
 * is a stated timing of nothing, which is a different answer from "this recipe
 * does not say".
 */
export function phaseMinutes(recipe: Recipe): number | null {
  const totals = recipePhaseTotals(recipe.metadata.phases);
  return totals.hasPhases ? totals.elapsedMinutes : null;
}

/**
 * A component row's time, on both screens that draw one. `null` when the
 * component states no timing, which is the row showing no time at all.
 */
export function componentTimeLabel(component: Recipe): string | null {
  const minutes = phaseMinutes(component);
  return minutes === null ? null : formatMinutes(minutes);
}
