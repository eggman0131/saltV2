import type {
  ParsedIngredientDoc,
  IngredientDoc,
  IngredientGroupDoc,
} from '../../schemas/recipe.js';

// The recipe ingredient graph (issue #179). Schema-first (issue #417): these are
// aliases of the inferred schema types from `@salt/domain/schemas` — the
// `IngredientSchema`/`IngredientGroupSchema`/`ParsedIngredientSchema` schemas are
// the single source of truth. The entity aliases stay so the recipe module's
// public surface is unchanged.

// Same enum as shoppingListItem (issue #179) — a recipe ingredient and a
// shopping-list item describe their canon match the same way. Derived from the
// schema so it can never drift from the wire contract.
export type MatchState = IngredientDoc['matchState'];

// The structured interpretation of an ingredient line. `item` is the cleaned,
// pre-canon name only — canon owns the canonical name (stored as `canonId` on
// the Ingredient). null fields mean "absent", not "unknown".
export type ParsedIngredient = ParsedIngredientDoc;

// `rawText` is ALWAYS preserved — parsing is lossy and edits must round-trip, so
// the original line is never destroyed by re-parsing or canonicalisation.
export type Ingredient = IngredientDoc;

// A named section of ingredients, e.g. "For the sauce". `name` is null for the
// recipe's default/unnamed group.
export type IngredientGroup = IngredientGroupDoc;
