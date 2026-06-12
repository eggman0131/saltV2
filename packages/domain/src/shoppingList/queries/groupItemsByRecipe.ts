import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import type { CheckedBucket } from './groupItemsByAisle.js';

// One recipe's contribution to the list. `recipeName` is the source label (or a
// generic fallback). Items are the unchecked rows sourced from this recipe, in
// stable creation order. No combining here — within a single recipe each
// ingredient is already a distinct row.
export interface RecipeGroup {
  readonly recipeId: string;
  readonly recipeName: string;
  readonly items: readonly ShoppingListItem[];
}

// Manually-added items, shown in their own section at the bottom of the
// recipe-sorted view.
export interface ManualBucket {
  readonly items: readonly ShoppingListItem[];
}

export interface GroupedByRecipe {
  readonly recipes: readonly RecipeGroup[];
  readonly manual: ManualBucket;
  readonly checked: CheckedBucket;
}

// Group an item by its primary source (`sources[0]`), mirroring how the rest of
// the shopping view derives a row's origin.
export function groupItemsByRecipe(items: readonly ShoppingListItem[]): GroupedByRecipe {
  const checkedItems: ShoppingListItem[] = [];
  const manualItems: ShoppingListItem[] = [];
  // Preserve first-seen insertion order of recipes via Map iteration order.
  const recipeMap = new Map<string, { recipeName: string; items: ShoppingListItem[] }>();

  for (const item of items) {
    if (item.checked) {
      checkedItems.push(item);
      continue;
    }

    const source = item.sources[0];
    if (source && source.kind === 'recipe') {
      const bucket = recipeMap.get(source.recipeId);
      if (bucket) {
        bucket.items.push(item);
      } else {
        recipeMap.set(source.recipeId, {
          recipeName: source.label ?? 'Recipe',
          items: [item],
        });
      }
    } else {
      manualItems.push(item);
    }
  }

  // Most-recently-checked first so the shopper can easily undo (matches aisle view).
  checkedItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const byCreatedAt = (a: ShoppingListItem, b: ShoppingListItem): number =>
    a.createdAt.localeCompare(b.createdAt);

  manualItems.sort(byCreatedAt);

  const recipes: RecipeGroup[] = [...recipeMap.entries()].map(([recipeId, g]) => ({
    recipeId,
    recipeName: g.recipeName,
    items: [...g.items].sort(byCreatedAt),
  }));

  // Recipes sorted alphabetically by name; recipeId breaks ties for stability.
  recipes.sort((a, b) => {
    const byName = a.recipeName.localeCompare(b.recipeName, undefined, { sensitivity: 'base' });
    return byName !== 0 ? byName : a.recipeId.localeCompare(b.recipeId);
  });

  return {
    recipes,
    manual: { items: manualItems },
    checked: { contributors: checkedItems },
  };
}
