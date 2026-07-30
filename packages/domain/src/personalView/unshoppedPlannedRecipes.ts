import type { MealPlanWeek } from '../mealPlan/index.js';
import type { Recipe } from '../recipe/index.js';
import { flattenIngredients } from '../recipe/index.js';
import type { ShoppingListItem } from '../shoppingList/index.js';

export interface UnshoppedPlannedRecipe {
  /** The night it is planned for (`YYYY-MM-DD`); the earliest, if planned twice. */
  readonly date: string;
  readonly recipeId: string;
  /** How many ingredient lines the recipe would put on the list. */
  readonly missingCount: number;
}

// Planned recipes that nothing on the shopping list came from — "Friday's Noodle
// Bowl, and none of it is on the list" (issue #634). The one genuinely new piece
// of logic in the personal view, and useful on the planner whether or not that
// view ships.
//
// "Shopped for" is presence, not completeness: an item carrying a `recipe` source
// for this recipe means somebody ran the add-to-list flow, so the recipe drops out
// of the result. Per-INGREDIENT coverage is not knowable from the documents —
// list items record which recipe they came from, never which ingredient line — so
// `missingCount` is what an add would put on the list (the recipe's ingredient
// lines), which is exactly the number the "Add all" it offers would write. A
// checked-off item still counts as shopped: it was bought.
//
// One entry per RECIPE, keyed to the earliest date it is planned on — the same
// dish planned twice is one shopping problem, not two.
//
// `from` is the first date worth nagging about (normally today): a Monday that has
// already been cooked cannot be shopped for. Pure — the caller supplies it, no
// clock here (CLAUDE.md Rule 1).
export function unshoppedPlannedRecipes(
  week: MealPlanWeek,
  items: readonly ShoppingListItem[],
  recipes: readonly Recipe[],
  from: string,
): UnshoppedPlannedRecipe[] {
  const shopped = new Set<string>();
  for (const item of items) {
    for (const source of item.sources) {
      if (source.kind === 'recipe') shopped.add(source.recipeId);
    }
  }
  const byId = new Map(recipes.map((r) => [r.id, r]));

  const seen = new Set<string>();
  const out: UnshoppedPlannedRecipe[] = [];
  for (const date of Object.keys(week.days).sort()) {
    if (date < from) continue;
    for (const recipeId of week.days[date]?.recipeIds ?? []) {
      if (shopped.has(recipeId) || seen.has(recipeId)) continue;
      // A planned recipe we can't resolve (deleted since it was planned) has
      // nothing to add and no title to name it by — say nothing about it.
      const recipe = byId.get(recipeId);
      if (!recipe) continue;
      seen.add(recipeId);
      // A recipe with no ingredient lines can never be shopped for: an add-to-list
      // would write nothing, so nothing can ever carry a source back to it and the
      // card would sit there for ever saying "0 to add". Keyed on the ingredient
      // COUNT, deliberately not on the recipe's kind — an entry with nothing to
      // buy is the same non-problem however it got that way. Note the guard comes
      // AFTER `seen.add`, so the same empty dish planned twice stays deduped.
      const missingCount = flattenIngredients(recipe).length;
      if (missingCount === 0) continue;
      out.push({ date, recipeId, missingCount });
    }
  }
  return out;
}
