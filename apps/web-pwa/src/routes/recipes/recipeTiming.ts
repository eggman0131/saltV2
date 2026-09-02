import { recipePhaseTotals, type Recipe } from '@salt/domain';

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
