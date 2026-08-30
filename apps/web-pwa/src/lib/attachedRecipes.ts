// Resolving the recipe ids a plan holds (issues #17, #940).
//
// A day stores recipe IDS only; titles, thumbnails and everything else resolve
// live at render time. There is no denormalisation, so a recipe deleted since it
// was attached must be SKIPPED rather than rendered as a broken row — that skip
// is the whole reason these functions exist, and it was asserted nowhere in the
// repo until issue #1055's characterisation net went in.
//
// In `lib/` rather than beside the planner routes because two consumers are in
// `lib/personalViewService.ts`, and nothing in `lib/` imports from `routes/`.

import type { Recipe } from '@salt/domain';

/**
 * The index to resolve against, given a caller that may or may not have one.
 *
 * The planner pages pass the shared `recipesById` store (issue #940), so the
 * index is built once per change to `recipes` rather than once per component.
 * The fallback builds one from a plain list — correct, but per instance, so it
 * is for callers that only have the array: the component tests, and any surface
 * that has not been handed the store.
 */
export function recipeIndex(
  index: ReadonlyMap<string, Recipe> | undefined,
  fallback: readonly Recipe[],
): ReadonlyMap<string, Recipe> {
  return index ?? new Map(fallback.map((r) => [r.id, r]));
}

/**
 * The recipes a day's `recipeIds` point at, in the order the DAY holds them.
 *
 * Three properties, all of them load-bearing and all of them pinned by tests:
 *
 *  - **Order follows `ids`, not the store.** The day's order is the plan's
 *    order; the store's is arbitrary.
 *  - **An id that resolves to nothing is skipped.** A recipe deleted since it
 *    was attached leaves an id behind, and rendering a row for it would put a
 *    blank line in the middle of a night's plan.
 *  - **Duplicates are preserved.** Two entries in, two entries out. Nothing in
 *    the app can currently produce a duplicated id (the picker excludes what is
 *    already attached), so this is inherited behaviour rather than a feature —
 *    but callers that render a KEYED `{#each}` over the result would throw on
 *    one, which is worth knowing before adding a path that can create them.
 */
export function resolveRecipeIds(
  ids: readonly string[],
  byId: ReadonlyMap<string, Recipe>,
): readonly Recipe[] {
  return ids.map((id) => byId.get(id)).filter((r): r is Recipe => r !== undefined);
}
