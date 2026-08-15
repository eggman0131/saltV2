import type { RecipeKind } from '../entities/Recipe.js';

// What a kind of entry can do (issue #637). These predicates are the ONLY
// place a `RecipeKind` is ever inspected: no call site outside packages/domain
// branches on the kind itself, so adding a fourth kind is a one-file change here
// and every screen inherits the right behaviour.
//
// The table is a `Record<RecipeKind, …>` rather than a chain of comparisons on
// purpose: a new member of the enum fails to compile until it has answered every
// question, instead of silently inheriting whatever `!== 'outing'` said.
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
  // Whether the LIBRARIAN can produce this kind: gates every path where the AI
  // authors a whole entry from a conversation — chat → "Save as recipe" and, on
  // top of it, ⋮ → "Make a variation" (issue #763).
  //
  // Read the `false` rows as "not yet", never as "by design". The constraint is
  // not about any one feature: `assembleRecipeDraft` hardcodes
  // `kind: baseRecipe?.kind ?? 'recipe'`, so no AI authoring path can currently
  // emit anything but a `recipe` — a cocktail authored by the librarian would
  // land in the dinner list permanently, because `kind` is immutable. The day
  // the librarian carries `kind` through, flipping the `cocktail` row here is
  // the only change needed and every consumer lights up with no edit of its own.
  //
  // `outing` and `placeholder` stay `false` on their own merits: an outing is a
  // hand-written night off with nothing to author, and a placeholder is a
  // photograph and a title.
  readonly isAuthorable: boolean;
  // Whether other dishes can be hung off this entry as its components (issue
  // #752): gates the editor's component picker and, with it, whether this entry
  // can ever become a meal. A meal is not a kind — a Sunday roast is an ordinary
  // recipe that happens to point at three others — so this asks the same question
  // `isCookable` asks and answers it separately on purpose: what it gates is a
  // COMPOSITION affordance, not a method to follow. A cocktail is `true` because
  // it can point at its own syrup recipe; an outing has nothing to compose (there
  // is no dish), and a placeholder is a photograph and a title.
  readonly takesComponents: boolean;
}

const CAPABILITIES: Record<RecipeKind, Capabilities> = {
  recipe: {
    takesIngredients: true,
    isCookable: true,
    isPlannable: true,
    isAuthorable: true,
    takesComponents: true,
  },
  outing: {
    takesIngredients: false,
    isCookable: false,
    isPlannable: true,
    isAuthorable: false,
    takesComponents: false,
  },
  cocktail: {
    takesIngredients: true,
    isCookable: true,
    isPlannable: false,
    isAuthorable: false,
    takesComponents: true,
  },
  // A placeholder is a photograph and a title, nothing else: nothing to buy,
  // nothing to cook, never offered in the picker, nothing for the librarian
  // to write, and nothing to build out of other dishes. Every downstream question
  // answers itself from this row.
  placeholder: {
    takesIngredients: false,
    isCookable: false,
    isPlannable: false,
    isAuthorable: false,
    takesComponents: false,
  },
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

export function isAuthorable(kind: RecipeKind): boolean {
  return CAPABILITIES[kind].isAuthorable;
}

export function takesComponents(kind: RecipeKind): boolean {
  return CAPABILITIES[kind].takesComponents;
}
