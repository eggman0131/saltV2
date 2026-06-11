import type { Recipe } from '../entities/Recipe.js';
import type { Ingredient } from '../entities/Ingredient.js';

// Flatten every ingredient across all groups, in document order. The seam used
// by canonicalisation (Phase 4) and shopping-list extraction (Phase 5), which
// operate per-ingredient regardless of grouping.
export function flattenIngredients(recipe: Recipe): readonly Ingredient[] {
  return recipe.ingredients.flatMap((group) => group.items);
}
