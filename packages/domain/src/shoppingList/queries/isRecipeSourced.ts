import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

// Whether a row arrived from a recipe rather than being typed by a person.
//
// Two callers, and they must agree: `groupItemsByAisle` uses it to decide what
// may combine (manual items never combine), and the shopping list's row renders
// recipe rows quantity-first — "1.5kg Whole Chicken", the way the recipe detail
// page reads them — while a manual row keeps the wording it was added with.
// One definition, so the two can never drift into disagreeing about which rows
// are the recipe's.
//
// Reads `sources[0]` because that is the only source a row is written with today
// (`addItem` for manual, `commitRecipeAddPlan` for recipe) — a first source of
// `'manual'` means a person put it there. Pure and I/O-free.
export function isRecipeSourced(item: ShoppingListItem): boolean {
  return item.sources[0]?.kind === 'recipe';
}
