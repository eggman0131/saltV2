import type { CookSessionDoc } from '../schemas/index.js';

// TOGGLE one mise-en-place ingredient: ticked ids are appended in tick order,
// unticking filters the id out. Immutable — always returns a new session (a toggle
// always changes something). `updatedAt` is left to the persistence seam.
export function withIngredientChecked(
  session: CookSessionDoc,
  ingredientId: string,
): CookSessionDoc {
  const checkedIngredientIds = session.checkedIngredientIds.includes(ingredientId)
    ? session.checkedIngredientIds.filter((x) => x !== ingredientId)
    : [...session.checkedIngredientIds, ingredientId];
  return { ...session, checkedIngredientIds };
}
