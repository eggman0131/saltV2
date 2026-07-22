import type { CookSessionDoc } from '../schemas/index.js';

// Bulk tick / untick, for when everything is already out on the bench and ticking
// fourteen rows is busywork. SYMMETRIC: `currentlyAllChecked` decides the
// direction, so tapping again clears the lot.
//
// `currentlyAllChecked` is passed in rather than recomputed because the caller
// already derives it for its button label, and it is a question about the RECIPE
// (are all of today's ingredients ticked?) not about the session — a session can
// carry ids for ingredients since edited out of the recipe.
export function withAllIngredientsChecked(
  session: CookSessionDoc,
  allIds: readonly string[],
  currentlyAllChecked: boolean,
): CookSessionDoc {
  return { ...session, checkedIngredientIds: currentlyAllChecked ? [] : [...allIds] };
}
