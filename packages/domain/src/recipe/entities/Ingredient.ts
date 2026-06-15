import type { Quantity } from './Quantity.js';

// Same enum as shoppingListItem (issue #179) — kept identical so a recipe
// ingredient and a shopping-list item describe their canon match the same way.
// Defined locally to keep the recipe module self-contained, like the other
// domain modules; the wire contract is enforced by the zod enum on read.
export type MatchState = 'pending' | 'matched' | 'failed';

// The structured interpretation of an ingredient line. `item` is the cleaned,
// pre-canon name only — canon owns the canonical name (stored as `canonId` on
// the Ingredient). null fields mean "absent", not "unknown".
export interface ParsedIngredient {
  readonly quantity: Quantity | null;
  // Metric unit only ('g' | 'ml'). null for count/item-based ingredients.
  readonly unit: 'g' | 'ml' | null;
  readonly item: string;
  readonly preparation: readonly string[];
  readonly notes: string | null;
  // Human-friendly original measure (e.g. "½ tsp", "1 cup"). null if source
  // was already in g/ml or has no unit.
  readonly displayText: string | null;
}

export interface Ingredient {
  readonly id: string;
  // ALWAYS preserved. Parsing is lossy and edits must round-trip, so the
  // original line is never destroyed by re-parsing or canonicalisation.
  readonly rawText: string;
  // null = unparsed / parse deferred.
  readonly parsed: ParsedIngredient | null;
  // null until canonicalisation (Phase 4) runs; never an echoed canonical name.
  readonly canonId: string | null;
  readonly matchState: MatchState;
  readonly isOptional: boolean;
  // id of the Step that first uses this ingredient. AI populates in the deferred
  // AI epic; delete-step must clear inbound links (also deferred). Links by id only.
  readonly firstUsedInStepId: string | null;
}

// A named section of ingredients, e.g. "For the sauce". `name` is null for the
// recipe's default/unnamed group.
export interface IngredientGroup {
  readonly id: string;
  readonly name: string | null;
  readonly items: readonly Ingredient[];
}
