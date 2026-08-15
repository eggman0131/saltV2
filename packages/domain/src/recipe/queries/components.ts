import type { Recipe } from '../entities/Recipe.js';

// Meals — a dinner built from several dishes (issue #752).
//
// A meal is an ordinary `recipes/{id}` document carrying `componentRecipeIds`;
// there is no fifth `kind` and no second collection. Everything in this module
// obeys one invariant, and it is what keeps the feature small:
//
//   NOTHING AGGREGATES, NOTHING RECURSES.
//
// A recipe's ingredients are its own and its steps are its own — never a
// component's. Components resolve exactly ONE level deep, for display only, so a
// component's own components never appear. That is not a limitation waiting to be
// lifted: it is what makes a reference cycle inert (A pointing at B pointing at A
// simply renders one card each) and what keeps every read O(1) in the depth of the
// graph. Do not add an aggregate-the-ingredients or a walk-the-tree helper here.
//
// Pure by construction: no clock, no I/O, no randomness, and no mutation of any
// argument.

// Is this entry a meal? Derived, never declared — the question is only ever "does
// it point at anything", so a document cannot be a meal with nothing in it, and
// nothing has to be kept in step when the last component is removed.
export function hasComponents(recipe: Pick<Recipe, 'componentRecipeIds'>): boolean {
  return recipe.componentRecipeIds.length > 0;
}

// The component recipes, in `componentRecipeIds` order — the user's drag order is
// the stored order, so this never re-sorts.
//
// An id that resolves to nothing is SKIPPED silently: a component recipe deleted
// elsewhere leaves a dangling reference, and a meal quietly losing a card is far
// better than one rendering a broken row nobody can act on. This is the same
// treatment `MealDayEditor` gives a deleted recipe on a planner day, and it is why
// removal needs no cascade, no tombstone and no clean-up pass.
export function resolveComponents(recipe: Recipe, allRecipes: readonly Recipe[]): Recipe[] {
  return recipe.componentRecipeIds
    .map((id) => allRecipes.find((r) => r.id === id))
    .filter((r): r is Recipe => r !== undefined);
}

// May `candidateId` be attached to `ownerId`? The self-reference guard, and
// deliberately nothing more: a recipe inside itself is the one relationship that
// is meaningless at any depth, whereas A→B→A is merely unusual and already inert
// (see the one-level rule above), so it is allowed rather than policed.
//
// Two call sites — the picker's candidate filter, and `insertComponentByCookTime`
// below, which folds the same guard in so it cannot be bypassed by a caller that
// forgot to ask.
export function canBeComponentOf(ownerId: string, candidateId: string): boolean {
  return ownerId !== candidateId;
}

// Where a newly attached component lands. Longest-cooking-first, because that is
// the order you start things in: the bird goes in before the potatoes.
//
// COOK time, not total time — prep is done ahead and in any order, so it says
// nothing about when a dish has to begin. `cookTimeMinutes` is nullable and a
// component with no cook time sorts to the TOP, where it reads as "start this when
// you like" rather than being buried under everything that does declare a time.
//
// POSITIONAL ONLY: the existing array is never re-sorted. The stored order is the
// user's drag order, and a later attach must not silently undo an afternoon of
// arranging. An id already in `ids` that no longer resolves keeps its place and
// costs nothing — it is treated as having no cook time, exactly like the display
// path treats it as absent.
export function insertComponentByCookTime(
  ownerId: string,
  ids: readonly string[],
  newId: string,
  allRecipes: readonly Recipe[],
): string[] {
  if (!canBeComponentOf(ownerId, newId)) return [...ids];
  if (ids.includes(newId)) return [...ids];

  // Sort key, descending: a higher rank cooks for longer and therefore starts
  // earlier. "No cook time" is Infinity so it leads, and a dangling id shares that
  // answer rather than throwing.
  const rankOf = (id: string): number => {
    const minutes = allRecipes.find((r) => r.id === id)?.metadata.cookTimeMinutes ?? null;
    return minutes === null ? Infinity : minutes;
  };

  const newRank = rankOf(newId);
  const at = ids.findIndex((id) => rankOf(id) < newRank);
  if (at === -1) return [...ids, newId];
  return [...ids.slice(0, at), newId, ...ids.slice(at)];
}

// What lands in a planner day when this entry is attached to it: the entry
// itself, then its components. The expansion is FROZEN at attach time — editing
// the meal afterwards never rewrites a night already planned — which is what
// keeps `day.recipeIds` homogeneous: every planner consumer goes on resolving
// plain recipe ids against one store, with no idea meals exist.
//
// THE MEAL GOES FIRST, and two existing mechanics then do the right thing on
// their own: the day's note seeds from the first attached recipe's title (so it
// reads "Sunday roast"), and the day's card takes the first attached hero (so it
// wears the meal's photograph). Neither had to learn anything about meals.
//
// One level, like everything else here: a component's own components are not
// expanded, so a night gets the dishes the meal names and nothing further down.
//
// NO RECIPE STORE, and no filtering to ids that resolve — deliberately. A
// component deleted since it was attached yields a dangling id in the day, which
// every planner consumer already skips silently; it is inert, and it is the
// established behaviour. Filtering here would instead make a planner WRITE depend
// on store hydration, so a half-hydrated store would silently plan fewer dishes
// than the user picked — a far worse failure than an id that renders as nothing.
export function expandForPlanner(recipe: Recipe): string[] {
  return [recipe.id, ...recipe.componentRecipeIds];
}

// Fold an expansion into what a day already holds: `existing`, then every
// addition not already there, in the order they were offered.
//
// Nothing is re-sorted and nothing is removed — the day's order is the order its
// nights were built up in — and neither argument is mutated. Deduping is why a
// meal whose gravy is already on the night adds only the rest of it.
export function mergePlannerRecipeIds(
  existing: readonly string[],
  additions: readonly string[],
): string[] {
  const out = [...existing];
  for (const id of additions) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
