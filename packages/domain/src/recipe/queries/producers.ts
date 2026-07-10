import type { Recipe } from '../entities/Recipe.js';

// Resolve the producing recipe(s) for a grocery item ("buy or make", Phase 2).
// PURE: the caller supplies the recipe list — domain touches no store/IO (domain
// purity). A recipe "produces" a canon item when its `producesCanonId` equals the
// given canon id. More than one recipe can produce the same item, so every
// candidate is returned in list order and the caller disambiguates (e.g. a
// mini-picker); the self-reference guard (excluding the recipe being added from
// its own candidates) is a caller concern, kept out of this pure filter.
export function findProducingRecipes(
  recipes: readonly Recipe[],
  canonId: string,
): readonly Recipe[] {
  return recipes.filter((r) => r.producesCanonId === canonId);
}
