import type { CanonItem } from '../../canon/index.js';
import { resolveProductForm, type ProductForm } from '../../productForm/index.js';
import type { Ingredient } from '../entities/Ingredient.js';
import type { Recipe } from '../entities/Recipe.js';

/**
 * A match problem that a recipe line CANNOT show you by itself.
 *
 * Deliberately not "every line that isn't matched". A `pending`/`failed` line is
 * already visible where it matters — the recipe page marks it ✗ and offers
 * Canonicalise — so folding it in here would light a pip on every half-finished
 * recipe and teach you to ignore the pip. What earns a pip is a line that looks
 * finished and is not:
 *
 * - `dangling_canon` — the line points at a canon item that has since been
 *   deleted or merged away. It reads as matched and buys nothing.
 * - `missing_form` — the line is measured by mass or volume but the thing it
 *   buys is sold by the count, and no product form bridges the two. It reads as
 *   matched and buys "90 ml lime" instead of three limes (issue #855). A product
 *   form is exactly the missing piece, and re-matching is what mints one.
 */
export type IngredientMatchIssue = 'dangling_canon' | 'missing_form';

/**
 * What (if anything) is silently wrong with one ingredient's match.
 *
 * `canonById` doubles as the live-canon set: a `canonId` absent from it is by
 * definition dangling. Pass the whole map rather than an id set because
 * `missing_form` needs the matched item's `unit`.
 *
 * Ordered cheapest-first on purpose. `resolveProductForm` walks every form's
 * every phrase, and this runs per ingredient per recipe across a whole list, so
 * the count/metric pre-checks — which reject the overwhelming majority of lines
 * on two field reads — are what keep that affordable.
 */
export function ingredientMatchIssue(
  ing: Ingredient,
  canonById: ReadonlyMap<string, CanonItem>,
  forms: readonly ProductForm[],
): IngredientMatchIssue | null {
  if (ing.canonId === null) return null; // never matched — visible already, see above
  const canon = canonById.get(ing.canonId);
  if (canon === undefined) return 'dangling_canon';
  if (canon.unit !== 'count') return null;
  if (ing.parsed === null || ing.parsed.unit === null) return null;
  const form = resolveProductForm(ing.parsed.item, forms);
  // A form that resolves to some OTHER parent is not this line's bridge — the
  // same guard every other product-form read applies.
  return form !== null && form.parentCanonId === ing.canonId ? null : 'missing_form';
}

/** How many of a recipe's lines are silently mis-matched. 0 for an entry with no ingredients. */
export function recipeMatchIssueCount(
  recipe: Recipe,
  canonById: ReadonlyMap<string, CanonItem>,
  forms: readonly ProductForm[],
): number {
  let count = 0;
  for (const group of recipe.ingredients) {
    for (const ing of group.items) {
      if (ingredientMatchIssue(ing, canonById, forms) !== null) count++;
    }
  }
  return count;
}
