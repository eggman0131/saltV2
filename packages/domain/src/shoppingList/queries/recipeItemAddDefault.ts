import type { ShoppingBehavior } from '@salt/shared-types';

// The default toggle state for one ingredient row in the recipe-add review step
// (issue #185). `add` = goes on the list; `check` = lands flagged for verification
// (implies add). The user can override either before confirming.
export interface RecipeItemAddDefault {
  readonly add: boolean;
  readonly check: boolean;
}

// Decide the default Add/Check toggles for a recipe ingredient being extracted to
// the shopping list, from its matched canon item's `shoppingBehavior`:
//   - `needed`  → buy it (add, no check)
//   - `check`   → buy it but verify (add + check)
//   - `stocked` → assume you have it (neither) UNLESS the recipe needs more than
//                 `largeQuantityThreshold` of it, in which case treat it like
//                 `needed`. The comparison is numeric in the canon item's own
//                 unit; `scaledAmount` is the recipe's scaled requirement.
// `behavior === null` means the ingredient has no live canon match — there is no
// staple knowledge to lean on, so default to buying it (add, no check), matching
// the pre-#185 behaviour of never silently dropping an unmatched ingredient.
export function recipeItemAddDefault(
  behavior: ShoppingBehavior | null,
  scaledAmount: number | null,
  largeQuantityThreshold: number | undefined,
): RecipeItemAddDefault {
  if (behavior === null) return { add: true, check: false };
  switch (behavior) {
    case 'needed':
      return { add: true, check: false };
    case 'check':
      return { add: true, check: true };
    case 'stocked': {
      const overThreshold =
        largeQuantityThreshold !== undefined &&
        scaledAmount !== null &&
        scaledAmount > largeQuantityThreshold;
      return overThreshold ? { add: true, check: false } : { add: false, check: false };
    }
  }
}
