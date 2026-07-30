// Presentation for the three kinds of `recipes/{id}` entry (issue #637).
//
// This module holds COPY and ICONS only — the words and pictures each kind wears
// on screen. It never decides whether a section, button or action exists: every
// capability question goes through `takesIngredients` / `isCookable` /
// `isPlannable` in `@salt/domain`, so adding a fourth kind still only changes
// behaviour in one place. What lands here is the part a predicate cannot answer:
// what to CALL the thing.
//
// It lives beside the recipe routes rather than in `src/lib` on purpose. The
// recipe pages' unit tests hand-roll a full `vi.mock` factory for
// `../src/lib/recipeService.js` listing every export the page imports, so a new
// lib-level import would silently break suites this phase must leave unedited.
//
// The UI label for `outing` is "When you CBA"; the enum value stays neutral so
// the copy can be reworded later without touching a single stored document.
import type { Recipe, RecipeKind } from '@salt/domain';
import type { IconProps } from '@salt/ui-components';

// Read a kind off a recipe-shaped object, defaulting exactly as the schema does.
//
// `RecipeSchema` supplies `.default('recipe')`, so every document that came back
// through `firebase-sync` already carries a kind and this is a pass-through. The
// default is repeated here for the objects that did NOT come through a parse —
// a draft stashed by the URL importer, a partially-built editor draft, a test
// fixture written before #637 — which would otherwise miss the capability table
// entirely and take a screen down over a field that has a well-defined default.
// The parameter is deliberately typed with an optional `kind` so the fallback is
// visibly load-bearing rather than dead code the compiler has already ruled out.
export function kindOf(recipe: { readonly kind?: RecipeKind } | Recipe): RecipeKind {
  return recipe.kind ?? 'recipe';
}

interface KindCopy {
  // Section name: the filter chip on the list, and the suffix on editor titles.
  readonly label: string;
  // Count noun for the result line ("3 recipes", "3 ideas").
  readonly one: string;
  readonly many: string;
  // Editor page titles. `recipe` keeps today's exact wording — /recipes/new is
  // pinned by an e2e spec and three unit suites that must pass unedited.
  readonly newTitle: string;
  readonly editTitle: string;
  // Toasts on save — first save, then every save after it.
  readonly createdToast: string;
  readonly savedToast: string;
  // "This section is empty" — not a failed filter, just nothing added yet.
  readonly emptyText: string;
  // "Your filters excluded everything in this section."
  readonly noMatchText: string;
  // Card thumbnail placeholder when there is no hero image.
  readonly thumbIcon: IconProps['name'];
  // New-menu entry icon.
  readonly menuIcon: IconProps['name'];
}

export const KIND_COPY: Record<RecipeKind, KindCopy> = {
  recipe: {
    label: 'Recipes',
    one: 'recipe',
    many: 'recipes',
    newTitle: 'New recipe',
    editTitle: 'Edit recipe',
    createdToast: 'Recipe created',
    savedToast: 'Recipe saved',
    emptyText: 'No recipes yet.',
    noMatchText: 'No recipes match your filters.',
    thumbIcon: 'CookingPot',
    menuIcon: 'Pencil',
  },
  outing: {
    label: 'When you CBA',
    one: 'idea',
    many: 'ideas',
    newTitle: 'New — When you CBA',
    editTitle: 'Edit — When you CBA',
    createdToast: 'Saved',
    savedToast: 'Saved',
    emptyText: 'Nothing here yet — a takeaway, a picnic, or a night off.',
    noMatchText: 'Nothing here matches your filters.',
    thumbIcon: 'HandPlatter',
    menuIcon: 'HandPlatter',
  },
  cocktail: {
    label: 'Cocktails',
    one: 'cocktail',
    many: 'cocktails',
    newTitle: 'New cocktail',
    editTitle: 'Edit cocktail',
    createdToast: 'Cocktail created',
    savedToast: 'Cocktail saved',
    emptyText: 'No cocktails yet.',
    noMatchText: 'No cocktails match your filters.',
    thumbIcon: 'Martini',
    menuIcon: 'Martini',
  },
};

// The sections the list page offers, in chip order. Cocktails have copy above
// but no chip: the kind exists end-to-end, the section lands in Phase 5.
export const KIND_SECTIONS: readonly RecipeKind[] = ['recipe', 'outing'];
