import type { RecipeKind } from '../entities/Recipe.js';

// What a kind of entry can do (issue #637). These three predicates are the ONLY
// place a `RecipeKind` is ever inspected: no call site outside packages/domain
// branches on the kind itself, so adding a fourth kind is a one-file change here
// and every screen inherits the right behaviour.
//
// The table is a `Record<RecipeKind, …>` rather than a chain of comparisons on
// purpose: a new member of the enum fails to compile until it has answered all
// three questions, instead of silently inheriting whatever `!== 'outing'` said.
//
// They take a `RecipeKind`, not a `Recipe`, because the kind is all they need
// and callers do not always hold a whole recipe — the planner picker filters
// candidates from a `Map<string, RecipeKind>` projection. Call sites with a
// recipe in hand pass `recipe.kind`, which reads as well as the alternative.
interface Capabilities {
  // Whether the CONCEPT of ingredients applies: gates the Ingredients section,
  // canonicalisation, and add-to-list. Deliberately distinct from
  // `flattenIngredients(recipe).length > 0` — a half-written recipe has no
  // ingredients yet and must still show the section it is meant to fill in.
  readonly takesIngredients: boolean;
  // Whether there is a method to follow: gates the Cook button, the Method card,
  // and the timings grid. An outing is eaten, not cooked.
  readonly isCookable: boolean;
  // Whether the entry is OFFERED in the meal planner's "Add a recipe…" picker.
  // Note what this does and does not say: it gates the picker's candidate list,
  // not what may sit in a day. A cocktail is not dinner and is never offered; a
  // placeholder (issue #652) is not offered either, but does occupy a slot —
  // it is attached on its own when a day is planned in a sentence, never chosen.
  readonly isPlannable: boolean;
}

const CAPABILITIES: Record<RecipeKind, Capabilities> = {
  recipe: { takesIngredients: true, isCookable: true, isPlannable: true },
  outing: { takesIngredients: false, isCookable: false, isPlannable: true },
  cocktail: { takesIngredients: true, isCookable: true, isPlannable: false },
  // A placeholder is a photograph and a title, nothing else: nothing to buy,
  // nothing to cook, and never offered in the picker. Every downstream question
  // answers itself from this row — including /mine's review queue (`needsReview`),
  // which gates on `isCookable` precisely so the stock-photo placeholders, written
  // once and never edited, don't sit in it for ever.
  placeholder: { takesIngredients: false, isCookable: false, isPlannable: false },
};

export function takesIngredients(kind: RecipeKind): boolean {
  return CAPABILITIES[kind].takesIngredients;
}

export function isCookable(kind: RecipeKind): boolean {
  return CAPABILITIES[kind].isCookable;
}

export function isPlannable(kind: RecipeKind): boolean {
  return CAPABILITIES[kind].isPlannable;
}
