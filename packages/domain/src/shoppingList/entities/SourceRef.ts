import type { SourceRefDoc } from '../../schemas/shoppingListItem.js';

// Where a shopping-list item came from — a manual add or a recipe. Schema-first
// (issue #417, carried here by issue #932): an alias of the inferred
// `SourceRefSchema` discriminated union, which lives beside the item schema
// that embeds it.
export type SourceRef = SourceRefDoc;
