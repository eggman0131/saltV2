// scripts/backfill-recipe-times.mjs's split between "already done, skip it" and
// "ask it" (issue #1210 review, blocking 2). Three flags feed one decision — which
// predicate counts as "done" (the stamp, or the strip) and whether `--redo`
// bypasses the skip entirely — and getting the arrow backwards on
// `--missing-phases` is silent and destructive: it asks precisely the recipes
// that already have a strip, one AI call each, overwriting every hand-corrected
// strip from #1202 phase 2. Nothing upstream catches that (`hasPhaseStrip`'s own
// tests are unaffected — the predicate itself is untouched), so this is pulled
// out to where a test can pin it, the same reason
// scripts/lib/recipeTimesEstimated.mjs exists: the script self-executes on
// import, so it has no other seam.
//
// `cookable` items only need `estimated` and `hasStrip` — whatever
// backfill-recipe-times.mjs's `listRecipes()` decorates each recipe with.

/**
 * Split a list of cookable recipes into the ones to skip and the ones to ask.
 *
 * @param {{ estimated: boolean, hasStrip: boolean }[]} cookable
 * @param {{ missingPhases: boolean, redo: boolean }} opts
 * @returns {{ alreadyDone: object[], toAsk: object[] }}
 */
export function selectRecipesToAsk(cookable, { missingPhases, redo }) {
  // DEFAULT (#952): done means stamped. --missing-phases (#1210): done means it
  // already carries a strip — asking it would overwrite a hand correction, which
  // is the one outcome this mode exists to prevent.
  const done = missingPhases ? (r) => r.hasStrip : (r) => r.estimated;
  const alreadyDone = redo ? [] : cookable.filter(done);
  const toAsk = redo ? cookable : cookable.filter((r) => !done(r));
  return { alreadyDone, toAsk };
}
