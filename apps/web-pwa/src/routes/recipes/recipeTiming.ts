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
// It is deliberately the SMALLEST shared thing: the fallback field and the wording
// still belong to each surface, because they honestly differ (the list falls back
// to `totalTimeMinutes`, a component row to `cookTimeMinutes`, and the cook plan
// says "No cook time" where the list says nothing at all). What is shared is the
// only part that must not vary — WHEN the phases answer, and what they answer.
//
// `componentTimeLabel` below is the ONE exception, and it does not weaken that
// (issue #1212, #1208's third bullet). It is not a general wording: it is the
// COMPONENT ROW's wording, and the recipe page's rows and the edit page's rows are
// the same row on two screens — the two copies were byte-for-byte identical, and a
// rule stated twice is a rule that can disagree with itself. The chip and the cook
// plan keep their own words because they genuinely say different things; these two
// never did.

/**
 * A recipe's elapsed time from its phase strip, or `null` when it has no strip.
 *
 * `null` is what makes the migration invisible: it is the answer with the feature
 * key off, and the answer for a recipe authored before #1122, and in both cases
 * the caller falls back to whichever of the three old fields it has always shown.
 * Phase 4 deletes the fallbacks; until then a library part-way through the
 * backfill reads correctly on every screen.
 *
 * `hasPhases` rather than `elapsedMinutes > 0`: a strip a cook has zeroed by hand
 * is a stated timing of nothing, and falling back there would put the old number
 * on screen beside a timeline that disagrees with it.
 */
export function phaseMinutes(recipe: Recipe, phasesEnabled: boolean): number | null {
  const totals = recipePhaseTotals(phasesEnabled ? recipe.metadata.phases : undefined);
  return totals.hasPhases ? totals.elapsedMinutes : null;
}

/**
 * A component row's time, on both screens that draw one: the phase sum when the
 * component has a strip, its stored cook time otherwise. `null` when it has
 * neither, which is the row showing no time at all.
 *
 * The fallback keeps the raw `n min` spelling it has always had rather than
 * borrowing `formatMinutes`, so with the feature key off this label is
 * byte-for-byte what it was before the strip existed.
 */
export function componentTimeLabel(component: Recipe, phasesEnabled: boolean): string | null {
  const minutes = phaseMinutes(component, phasesEnabled);
  if (minutes !== null) return formatMinutes(minutes);
  return component.metadata.cookTimeMinutes === null
    ? null
    : `${component.metadata.cookTimeMinutes} min`;
}
