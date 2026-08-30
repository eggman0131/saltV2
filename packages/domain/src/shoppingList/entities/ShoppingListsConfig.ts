import type { ShoppingListsConfigDoc } from '../../schemas/shoppingListsConfig.js';

// The singleton lists-config document. Schema-first (issue #417, carried here
// by issue #932): an alias of the inferred schema type.
export type ShoppingListsConfig = ShoppingListsConfigDoc;
