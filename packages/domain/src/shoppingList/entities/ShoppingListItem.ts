import type { ShoppingListItemDoc } from '../../schemas/shoppingListItem.js';

// Same enum as the recipe ingredient (issue #179) — a shopping-list item and a
// recipe ingredient describe their canon match the same way. Derived from the
// schema so it cannot drift from the wire contract (the `Ingredient.ts` form).
export type MatchState = ShoppingListItemDoc['matchState'];

// One Firestore document at `shoppingLists/{listId}/items/{id}`. Schema-first
// (issue #417, carried here by issue #932): `ShoppingListItemSchema` is the
// single source of truth, so the entity and the stored document can no longer
// drift behind a cast at the read boundary.
//
// `traceContext` is OMITTED, the same narrowing `CanonItem` makes and for the
// same reason: it is transport only. The browser stamps it onto the doc at "add
// to shopping list" so the onShoppingListItemWrite trigger can continue the
// browser-rooted trace; domain logic must never branch on it, and the pure
// domain item must not carry it (CLAUDE.md Rule 1). See the field's own comment
// on ShoppingListItemSchema.
//
// Every other field — including the optional `formDemand`, `originalText` and
// `measureNote` back-compat fields — comes straight from the schema.
export type ShoppingListItem = Omit<ShoppingListItemDoc, 'traceContext'>;
