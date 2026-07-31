// Presentation for the kinds of `recipes/{id}` entry (issues #637, #652).
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
  // Issue #652. The plural label is what the chip and the New menu say, matching
  // the other three; the singular is only ever a count noun. These entries are
  // read far more often by the person BUILDING the library than by anyone
  // browsing it — a placeholder reaches the planner on its own, never by being
  // picked — so the words are plain rather than coy.
  placeholder: {
    label: 'Placeholders',
    one: 'placeholder',
    many: 'placeholders',
    newTitle: 'New placeholder',
    editTitle: 'Edit placeholder',
    createdToast: 'Placeholder created',
    savedToast: 'Placeholder saved',
    emptyText: 'No placeholders yet — build a few and a note-only night gets a picture.',
    noMatchText: 'No placeholders match your filters.',
    thumbIcon: 'Images',
    menuIcon: 'Images',
  },
};

// The sections the list page offers, in chip order — and, minus the first, the
// New-menu entries too. `recipe` leads because it is where you land and what most
// entries are; it is also the only section whose New entry is NOT derived from
// this list, because /recipes/new (no kind segment) is pinned by an e2e spec.
//
// This array is the whole of a section's existence on the list page: adding a kind
// here gives it a chip, a New-menu entry and a filtered grid, because every screen
// below reads the kind's words from KIND_COPY and its behaviour from the domain
// capability predicates. Nothing else needs a fourth case.
export const KIND_SECTIONS: readonly RecipeKind[] = ['recipe', 'outing', 'cocktail', 'placeholder'];

// The sections whose chips are shown before you ask for the rest. Everything in
// KIND_SECTIONS still exists and is still one tap away — the chip row just leads
// with the two sections you actually browse (you cook dinner, you make a drink)
// and folds the rest behind a "+N more" chip, exactly as the tag row does. The
// two it hides are both places you WRITE to more than you read from: "When you
// CBA" is a handful of standing answers, and a placeholder is picked for you by
// the planner rather than browsed. Membership here is a presentation choice, so
// it lives beside the copy; it never decides whether a section exists.
export const PRIMARY_KIND_SECTIONS: readonly RecipeKind[] = ['recipe', 'cocktail'];
