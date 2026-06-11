import type { Ingredient } from '../entities/Ingredient.js';

// Resets the canon match on an ingredient whose rawText has been edited.
// Mirrors editItemRawText's behaviour for shopping-list items.
export function clearIngredientMatch(ing: Ingredient): Ingredient {
  return { ...ing, parsed: null, canonId: null, matchState: 'pending' };
}
