import type { ShoppingListDoc } from '../../schemas/shoppingList.js';

// One Firestore document at `shoppingLists/{id}`. Schema-first (issue #417,
// carried here by issue #932): an alias of the inferred schema type, so the
// entity and the stored document cannot drift.
export type ShoppingList = ShoppingListDoc;
