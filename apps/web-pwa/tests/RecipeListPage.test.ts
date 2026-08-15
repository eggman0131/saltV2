import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Recipe, RecipeKind } from '@salt/domain';
import { setNextCrop } from './fixtures/cropStub.js';

// ─── Mock stores and services ──────────────────────────────────────────────────
// The list page is a pure view over the recipeService stores; mock them so we can
// drive the search / sort / tag-filter pipeline without Firestore. Mirrors the
// store shim used by the RecipeEditPage tests.

const { mockRecipes, mockIsLoading } = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => {
          subs.delete(fn);
        };
      },
      _set(v: T) {
        value = v;
        subs.forEach((fn) => fn(v));
      },
    };
  }
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockIsLoading: makeStore<boolean>(false),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoading,
  importRecipeFromUrl: vi.fn(),
  urlImportMessage: vi.fn(),
  importRecipeFromPhoto: vi.fn(),
  photoImportMessage: vi.fn((outcome: { code?: string }) => `copy-for:${outcome.code}`),
  stashImportedDraft: vi.fn(),
  isSignedOutFailure: vi.fn((outcome: { kind: string }) => outcome.kind === 'AuthError'),
  stashPendingImportUrl: vi.fn(),
  takePendingImportUrl: vi.fn(() => null),
}));

// Only the cropper is swapped out of @salt/ui-components: jsdom has no canvas,
// so the real primitive can never produce cropped bytes (see
// tests/fixtures/StubImageCropper.svelte). Everything else the list page renders
// is the shipped primitive.
vi.mock('@salt/ui-components', async () => {
  const actual = await vi.importActual<typeof import('@salt/ui-components')>('@salt/ui-components');
  const stub = await import('./fixtures/StubImageCropper.svelte');
  return { ...actual, ImageCropper: stub.default };
});

import RecipeListPage from '../src/routes/recipes/RecipeListPage.svelte';
import { importRecipeFromPhoto, stashImportedDraft } from '../src/lib/recipeService.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRecipe(over: {
  id: string;
  title: string;
  tags: string[];
  totalTimeMinutes: number | null;
  servings: number | null;
  ingredientCount: number;
  image: Recipe['image'];
  imageHidden?: boolean;
  imageRequestedAt?: number;
  createdAt: string;
  kind?: RecipeKind;
  componentRecipeIds?: string[];
}): Recipe {
  return {
    id: over.id,
    schemaVersion: 1,
    kind: over.kind ?? 'recipe',
    title: over.title,
    description: null,
    ingredients: [
      {
        id: `${over.id}-g`,
        name: null,
        items: Array.from({ length: over.ingredientCount }, (_, i) => ({
          id: `${over.id}-i${i}`,
          rawText: `ingredient ${i}`,
          parsed: null,
          canonId: null,
          matchState: 'pending' as const,
          isOptional: false,
          firstUsedInStepId: null,
        })),
      },
    ],
    steps: [],
    metadata: {
      servings: over.servings,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: over.totalTimeMinutes,
      tags: over.tags,
    },
    source: null,
    notes: null,
    producesCanonId: null,
    // Empty unless a test is building a MEAL (issue #752) — the Meals section is
    // derived from this array being non-empty, never from a kind.
    componentRecipeIds: over.componentRecipeIds ?? [],
    image: over.image,
    ...(over.imageHidden !== undefined ? { imageHidden: over.imageHidden } : {}),
    ...(over.imageRequestedAt !== undefined ? { imageRequestedAt: over.imageRequestedAt } : {}),
    createdAt: over.createdAt,
    updatedAt: over.createdAt,
  };
}

const APPLE = makeRecipe({
  id: 'apple',
  title: 'Apple Pie',
  tags: ['dessert', 'baking'],
  totalTimeMinutes: 90,
  servings: 8,
  ingredientCount: 5,
  image: { url: 'http://img.test/apple.jpg', source: 'ai' },
  createdAt: '2026-01-01T00:00:00.000Z',
});
const BANANA = makeRecipe({
  id: 'banana',
  title: 'Banana Bread',
  tags: ['baking', 'quick'],
  totalTimeMinutes: 60,
  servings: 6,
  ingredientCount: 3,
  image: null, // → fallback tile
  createdAt: '2026-02-01T00:00:00.000Z',
});
const CARROT = makeRecipe({
  id: 'carrot',
  title: 'Carrot Soup',
  tags: ['soup', 'quick'],
  totalTimeMinutes: 30,
  servings: 4,
  ingredientCount: 4,
  image: { url: 'http://img.test/carrot.jpg', source: 'ai' },
  imageHidden: true, // retired/inert (Phase 1): still shows its hero despite this flag
  createdAt: '2026-03-01T00:00:00.000Z',
});

function seed(recipes: Recipe[]): void {
  mockRecipes._set(recipes);
}

function cardTitles(): string[] {
  return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.trim() ?? '');
}

// jsdom's textContent preserves source whitespace between expression tags; the
// browser collapses it. Normalise so assertions read against the rendered text.
function normalized(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

afterEach(() => {
  cleanup();
  seed([]);
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('RecipeListPage', () => {
  it('renders a card per recipe, sorted A–Z by default', () => {
    seed([CARROT, APPLE, BANANA]);
    render(RecipeListPage);

    expect(screen.getAllByTestId('recipe-list-item')).toHaveLength(3);
    expect(cardTitles()).toEqual(['Apple Pie', 'Banana Bread', 'Carrot Soup']);
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('3 recipes');
  });

  it('shows the hero image whenever a url exists (imageHidden retired) and a fallback tile otherwise', () => {
    seed([APPLE, BANANA, CARROT]);
    render(RecipeListPage);

    // Apple and Carrot both have image urls, so both show a hero — Carrot's
    // `imageHidden` is retired/inert (Phase 1) and no longer suppresses it. Only
    // Banana (image null) falls back to the placeholder tile.
    expect(screen.getAllByTestId('recipe-list-thumb')).toHaveLength(2);
    expect(screen.getAllByTestId('recipe-list-thumb-fallback')).toHaveLength(1);

    // Cards render A–Z, so Apple's thumb is first. It is cache-busted (issue
    // #460): Apple has no `imageRequestedAt`, so the nonce falls back to
    // `updatedAt`. The base URL carries no query, so the param is appended with
    // `?v=`.
    const src = screen.getAllByTestId('recipe-list-thumb')[0].getAttribute('src');
    expect(src).toBe(`http://img.test/apple.jpg?v=${APPLE.updatedAt}`);
  });

  it('cache-busts the thumb and re-fetches when imageRequestedAt changes even if the URL is unchanged', () => {
    // A regenerated hero reuses the SAME byte-identical Storage URL, so only the
    // per-regeneration nonce (`imageRequestedAt`) changes — the `?v=` param must
    // follow it or the browser serves the stale image (issue #460).
    const before = makeRecipe({
      id: 'peach',
      title: 'Peach Cobbler',
      tags: ['dessert'],
      totalTimeMinutes: 45,
      servings: 6,
      ingredientCount: 4,
      image: { url: 'http://img.test/peach.jpg', source: 'ai' },
      imageRequestedAt: 1000,
      createdAt: '2026-04-01T00:00:00.000Z',
    });
    seed([before]);
    const { unmount } = render(RecipeListPage);
    const srcBefore = screen.getByTestId('recipe-list-thumb').getAttribute('src');
    expect(srcBefore).toBe('http://img.test/peach.jpg?v=1000');
    unmount();

    // Same URL, new regeneration nonce → the rendered src must change.
    const after = { ...before, imageRequestedAt: 2000 };
    seed([after]);
    render(RecipeListPage);
    const srcAfter = screen.getByTestId('recipe-list-thumb').getAttribute('src');
    expect(srcAfter).toBe('http://img.test/peach.jpg?v=2000');
    expect(srcAfter).not.toBe(srcBefore);
  });

  it('surfaces time, servings and ingredient count on a card', () => {
    seed([APPLE]);
    render(RecipeListPage);

    const card = screen.getByTestId('recipe-list-item');
    expect(card.textContent).toContain('90 min');
    expect(card.textContent).toContain('8'); // servings
    expect(card.textContent).toContain('5'); // ingredient count
  });

  it('filters by search text over title and tags', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA, CARROT]);
    render(RecipeListPage);

    const search = screen.getByTestId('recipe-search-input');
    await user.type(search, 'apple');
    expect(cardTitles()).toEqual(['Apple Pie']);
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('filtered');

    // Tag text is searchable too: "soup" is a tag on Carrot Soup.
    await user.clear(search);
    await user.type(search, 'soup');
    expect(cardTitles()).toEqual(['Carrot Soup']);
  });

  it('narrows to recipes carrying a selected tag, and clears', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA, CARROT]);
    render(RecipeListPage);

    const filters = screen.getByTestId('recipe-tag-filters');
    const quickChip = within(filters).getByRole('button', { name: '#quick' });
    await user.click(quickChip);

    expect(cardTitles()).toEqual(['Banana Bread', 'Carrot Soup']);
    expect(quickChip).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('recipe-clear-filters'));
    expect(screen.getAllByTestId('recipe-list-item')).toHaveLength(3);
  });

  it('scopes the filter chips to tags on the currently displayed recipes', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA, CARROT]);
    render(RecipeListPage);

    const filterTags = () =>
      within(screen.getByTestId('recipe-tag-filters'))
        .getAllByTestId('recipe-tag-filter')
        .map((b) => b.getAttribute('data-tag'));

    // All tags across the library are offered before any filtering, now ranked
    // by usage (most-used first, alpha tie-break): baking & quick appear on two
    // recipes each, dessert & soup on one.
    expect(filterTags()).toEqual(['baking', 'quick', 'dessert', 'soup']);

    // Selecting "dessert" leaves only Apple Pie, so the chips collapse to Apple's
    // own tags (the selected one pinned) — "quick"/"soup" drop away.
    await user.click(
      within(screen.getByTestId('recipe-tag-filters')).getByRole('button', {
        name: '#dessert',
      }),
    );
    expect(cardTitles()).toEqual(['Apple Pie']);
    expect(filterTags()).toEqual(['baking', 'dessert']);
  });

  it('caps the tag chips at 10 by default and expands on demand', async () => {
    const user = userEvent.setup();
    const many = makeRecipe({
      id: 'many',
      title: 'Kitchen Sink',
      tags: Array.from({ length: 12 }, (_, i) => `tag${String(i).padStart(2, '0')}`),
      totalTimeMinutes: 20,
      servings: 2,
      ingredientCount: 2,
      image: null,
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    seed([many]);
    render(RecipeListPage);

    const chips = () =>
      within(screen.getByTestId('recipe-tag-filters')).getAllByTestId('recipe-tag-filter');

    // Collapsed: only the first 10 chips plus a "+2 more" expander.
    expect(chips()).toHaveLength(10);
    expect(screen.getByTestId('recipe-tag-show-all')).toHaveTextContent('+2 more');

    // Expanding reveals all 12 chips and swaps in a "Show less" control.
    await user.click(screen.getByTestId('recipe-tag-show-all'));
    expect(chips()).toHaveLength(12);
    expect(screen.queryByTestId('recipe-tag-show-all')).toBeNull();
    expect(screen.getByTestId('recipe-tag-show-less')).toBeInTheDocument();
  });

  it('shows an empty-filter state when nothing matches', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA, CARROT]);
    render(RecipeListPage);

    await user.type(screen.getByTestId('recipe-search-input'), 'zzz-no-match');
    expect(screen.queryByTestId('recipe-list')).toBeNull();
    expect(screen.getByTestId('recipe-no-matches')).toBeInTheDocument();
  });

  it('renders the full-collection empty state when there are no recipes', () => {
    seed([]);
    render(RecipeListPage);
    expect(screen.getByText('No recipes yet.')).toBeInTheDocument();
  });
});

// ─── Sections (issue #637) ────────────────────────────────────────────────────
// The chip row is a place you STAND, not a filter you have applied — which is
// why switching it clears the tag vocabulary but keeps your search, and why
// "Clear filters" leaves you exactly where you were.

const TAKEAWAY = makeRecipe({
  id: 'takeaway',
  kind: 'outing',
  title: 'Takeaway — Indian',
  tags: ['friday', 'quick'],
  totalTimeMinutes: null,
  servings: null,
  ingredientCount: 0,
  image: null,
  createdAt: '2026-06-01T00:00:00.000Z',
});
const PICNIC = makeRecipe({
  id: 'picnic',
  kind: 'outing',
  title: 'Picnic food',
  tags: ['summer'],
  totalTimeMinutes: null,
  servings: null,
  ingredientCount: 0,
  image: null,
  createdAt: '2026-06-02T00:00:00.000Z',
});

const NEGRONI = makeRecipe({
  id: 'negroni',
  kind: 'cocktail',
  title: 'Negroni',
  tags: ['aperitivo'],
  totalTimeMinutes: 5,
  servings: 1,
  ingredientCount: 3,
  image: null,
  createdAt: '2026-06-03T00:00:00.000Z',
});

// Meals (issue #752). Both of these are ordinary documents of an ordinary kind —
// what makes them meals is `componentRecipeIds`, and nothing else. The cocktail
// one is the point of the fifth capability column: a drink built on a house syrup
// is the same relationship a roast has with its gravy.
const SUNDAY_ROAST = makeRecipe({
  id: 'roast',
  title: 'Sunday roast',
  tags: ['sunday'],
  totalTimeMinutes: 120,
  servings: 4,
  ingredientCount: 4,
  image: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  componentRecipeIds: ['chicken', 'potatoes', 'gravy'],
});
const NEGRONI_WITH_SYRUP = makeRecipe({
  id: 'negroni-syrup',
  kind: 'cocktail',
  title: 'Negroni with house syrup',
  tags: ['aperitivo'],
  totalTimeMinutes: 5,
  servings: 1,
  ingredientCount: 3,
  image: null,
  createdAt: '2026-07-02T00:00:00.000Z',
  componentRecipeIds: ['syrup'],
});

function queryKindChip(kind: string): HTMLElement | undefined {
  const row = screen.getByTestId('recipe-kind-filters');
  return within(row)
    .queryAllByTestId('recipe-kind-filter')
    .find((b) => b.getAttribute('data-kind') === kind);
}

function kindChip(kind: string): HTMLElement {
  const chip = queryKindChip(kind);
  if (!chip) throw new Error(`no chip for kind ${kind}`);
  return chip;
}

// Only the primary sections are on screen to start with; the rest sit behind the
// "+N more" chip. Reaching one is reveal-then-pick, so every test that switches
// section goes through here rather than assuming which chips are rendered.
async function pickKind(user: ReturnType<typeof userEvent.setup>, kind: string): Promise<void> {
  if (!queryKindChip(kind)) await user.click(screen.getByTestId('recipe-kind-show-all'));
  await user.click(kindChip(kind));
}

describe('RecipeListPage — sections', () => {
  it('shows only recipes by default, behind the three primary section chips', () => {
    seed([APPLE, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    expect(cardTitles()).toEqual(['Apple Pie']);
    expect(kindChip('recipe')).toHaveAttribute('aria-pressed', 'true');
    // Meals joined the primary row in #752, second after Recipes: it has no
    // New-menu entry of its own, so the chip is the only thing that says the
    // shelf exists.
    expect(kindChip('meal')).toHaveAttribute('aria-pressed', 'false');
    expect(kindChip('cocktail')).toHaveAttribute('aria-pressed', 'false');
    // The other two are not gone, just folded away — the row leads with the
    // sections you browse and counts the rest, exactly as the tag row does.
    expect(queryKindChip('outing')).toBeUndefined();
    expect(queryKindChip('placeholder')).toBeUndefined();
    expect(screen.getAllByTestId('recipe-kind-filter')).toHaveLength(3);
    expect(normalized(screen.getByTestId('recipe-kind-show-all'))).toBe('+2 more');
  });

  it('reveals every section behind the "+N more" chip, and folds them back', async () => {
    const user = userEvent.setup();
    seed([APPLE, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    await user.click(screen.getByTestId('recipe-kind-show-all'));

    // All five sections, and only five — a chip row you STAND in, so a sixth
    // would be a section that shipped without anyone deciding to. The fourth
    // (issue #652) was decided: you need somewhere to open Regenerate from, and
    // that is the view page you reach from this grid. The fifth is Meals (#752),
    // which is a section and NOT a kind — you cannot create one.
    expect(screen.getAllByTestId('recipe-kind-filter')).toHaveLength(5);
    expect(kindChip('outing')).toHaveAttribute('aria-pressed', 'false');
    expect(kindChip('placeholder')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('recipe-kind-show-all')).toBeNull();

    await user.click(screen.getByTestId('recipe-kind-show-less'));
    expect(screen.getAllByTestId('recipe-kind-filter')).toHaveLength(3);
  });

  it('pins the section you are standing in when the row folds back up', async () => {
    const user = userEvent.setup();
    seed([APPLE, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    await pickKind(user, 'outing');
    await user.click(screen.getByTestId('recipe-kind-show-less'));

    // Collapsing must never hide the chip that says where you are — otherwise
    // the row claims you are in Recipes while the grid shows outings.
    expect(kindChip('outing')).toHaveAttribute('aria-pressed', 'true');
    expect(cardTitles()).toEqual(['Picnic food', 'Takeaway — Indian']);
    expect(queryKindChip('placeholder')).toBeUndefined();
  });

  it('switches sections and shows only that section', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    await pickKind(user, 'outing');

    expect(cardTitles()).toEqual(['Picnic food', 'Takeaway — Indian']);
    expect(kindChip('outing')).toHaveAttribute('aria-pressed', 'true');
    expect(kindChip('recipe')).toHaveAttribute('aria-pressed', 'false');
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('2 ideas');
  });

  it('offers an empty section rather than hiding it', async () => {
    const user = userEvent.setup();
    // Recipes exist, outings do not — the section must still be reachable so you
    // can see for yourself that there is nothing in it.
    seed([APPLE, BANANA]);
    render(RecipeListPage);

    await pickKind(user, 'outing');

    expect(screen.queryByTestId('recipe-list')).toBeNull();
    expect(screen.getByTestId('recipe-kind-empty')).toBeInTheDocument();
    // Nothing to clear: this is an empty section, not a failed filter.
    expect(screen.queryByTestId('recipe-no-matches')).toBeNull();
    expect(screen.queryByTestId('recipe-clear-filters')).toBeNull();
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('0 ideas');
  });

  it('re-facets the tag chips to the section you are standing in', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    const filterTags = () =>
      within(screen.getByTestId('recipe-tag-filters'))
        .getAllByTestId('recipe-tag-filter')
        .map((b) => b.getAttribute('data-tag'));

    expect(filterTags()).toEqual(['baking', 'dessert', 'quick']);

    await pickKind(user, 'outing');
    // Only the outings' own tags — "baking" and "dessert" are recipe vocabulary.
    expect(filterTags()).toEqual(['friday', 'quick', 'summer']);
  });

  it('clears the selected tags on a switch but keeps what you typed', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    // "quick" exists in BOTH sections, so a stale selection would silently
    // survive the switch unless it is explicitly dropped.
    await user.click(
      within(screen.getByTestId('recipe-tag-filters')).getByRole('button', { name: '#quick' }),
    );
    expect(cardTitles()).toEqual(['Banana Bread']);

    const search = screen.getByTestId('recipe-search-input');
    await user.type(search, 'a');

    await pickKind(user, 'outing');

    // Tag dropped: both outings show, not just the one tagged "quick".
    expect(
      within(screen.getByTestId('recipe-tag-filters'))
        .getAllByTestId('recipe-tag-filter')
        .every((b) => b.getAttribute('aria-pressed') === 'false'),
    ).toBe(true);
    // Search kept: "Picnic food" has no "a", "Takeaway — Indian" does.
    expect(search).toHaveValue('a');
    expect(cardTitles()).toEqual(['Takeaway — Indian']);
  });

  it('does not throw you back to Recipes when you clear the filters', async () => {
    const user = userEvent.setup();
    seed([APPLE, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    await pickKind(user, 'outing');
    await user.type(screen.getByTestId('recipe-search-input'), 'picnic');
    expect(cardTitles()).toEqual(['Picnic food']);

    await user.click(screen.getByTestId('recipe-clear-filters'));

    expect(kindChip('outing')).toHaveAttribute('aria-pressed', 'true');
    expect(cardTitles()).toEqual(['Picnic food', 'Takeaway — Indian']);
  });

  it('reports "filtered" for a search but never merely for a section', async () => {
    const user = userEvent.setup();
    seed([APPLE, TAKEAWAY, PICNIC]);
    render(RecipeListPage);

    await pickKind(user, 'outing');
    expect(normalized(screen.getByTestId('recipe-result-count'))).not.toContain('filtered');

    await user.type(screen.getByTestId('recipe-search-input'), 'picnic');
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('filtered');
  });

  it('drops the ingredient count from cards that cannot have ingredients', async () => {
    const user = userEvent.setup();
    seed([APPLE, TAKEAWAY]);
    render(RecipeListPage);

    // A recipe card carries three meta chips (time, servings, ingredients).
    expect(screen.getByTestId('recipe-list-item').textContent).toContain('5');

    await pickKind(user, 'outing');
    // No "0 ingredients" chip on a takeaway — the concept does not apply.
    const card = screen.getByTestId('recipe-list-item');
    expect(card.textContent).not.toContain('0');
  });

  it('routes the New menu straight to the outing editor', async () => {
    const user = userEvent.setup();
    const { push } = await import('svelte-spa-router');
    seed([APPLE]);
    render(RecipeListPage);

    await user.click(screen.getByTestId('recipe-new-btn'));
    await user.click(screen.getByTestId('recipe-new-outing'));

    expect(push).toHaveBeenCalledWith('/recipes/new/outing');
  });

  // ─── Cocktails (Phase 5) ───────────────────────────────────────────────────
  // A cocktail IS a recipe — ingredients, a method, the full editor and the full
  // recipe page. It differs in exactly three places, and two of them are here: its
  // own chip and its own way in. (The third — never offered in the dinner planner —
  // is `isPlannable('cocktail') === false`, pinned in MealPlanWeekPage.test.ts.)

  it('switches to the Cocktails section and shows only cocktails', async () => {
    const user = userEvent.setup();
    seed([APPLE, TAKEAWAY, NEGRONI]);
    render(RecipeListPage);

    await pickKind(user, 'cocktail');

    expect(cardTitles()).toEqual(['Negroni']);
    expect(kindChip('cocktail')).toHaveAttribute('aria-pressed', 'true');
    expect(kindChip('recipe')).toHaveAttribute('aria-pressed', 'false');
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('1 cocktail');
  });

  it('keeps cocktails out of the Recipes section', async () => {
    // The chip row is the only thing separating them; a cocktail must not also
    // show up under Recipes just because it is cookable.
    seed([APPLE, NEGRONI]);
    render(RecipeListPage);

    expect(cardTitles()).toEqual(['Apple Pie']);
  });

  it('keeps the ingredient count on a cocktail card — a cocktail has ingredients', async () => {
    const user = userEvent.setup();
    seed([APPLE, NEGRONI]);
    render(RecipeListPage);

    await pickKind(user, 'cocktail');

    // `takesIngredients('cocktail')` is true, so unlike an outing the count stays.
    expect(screen.getByTestId('recipe-list-item').textContent).toContain('3');
  });

  it('routes the New menu straight to the cocktail editor', async () => {
    const user = userEvent.setup();
    const { push } = await import('svelte-spa-router');
    seed([APPLE]);
    render(RecipeListPage);

    await user.click(screen.getByTestId('recipe-new-btn'));
    await user.click(screen.getByTestId('recipe-new-cocktail'));

    expect(push).toHaveBeenCalledWith('/recipes/new/cocktail');
  });

  // ─── Meals (issue #752) ────────────────────────────────────────────────────
  // A section that is NOT a kind. A Sunday roast is an ordinary recipe document
  // that has gained `componentRecipeIds`; "is this a meal?" is derived from that
  // array being non-empty, so nothing is stored, nothing is created, and one
  // entry stands on exactly one shelf.

  it('puts a recipe with components under Meals and takes it out of Recipes', async () => {
    const user = userEvent.setup();
    seed([APPLE, SUNDAY_ROAST]);
    render(RecipeListPage);

    // The single membership rule: the roast is gone from the section its KIND
    // would put it in, and it is the only thing under Meals.
    expect(cardTitles()).toEqual(['Apple Pie']);

    await pickKind(user, 'meal');

    expect(cardTitles()).toEqual(['Sunday roast']);
    expect(kindChip('meal')).toHaveAttribute('aria-pressed', 'true');
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('1 meal');
  });

  it('collects meals of any kind — a cocktail with components is a meal too', async () => {
    const user = userEvent.setup();
    seed([APPLE, SUNDAY_ROAST, NEGRONI_WITH_SYRUP]);
    render(RecipeListPage);

    await pickKind(user, 'meal');
    expect(cardTitles()).toEqual(['Negroni with house syrup', 'Sunday roast']);

    // ...and it has left Cocktails, exactly as the roast left Recipes.
    await user.click(kindChip('cocktail'));
    expect(screen.queryByTestId('recipe-list')).toBeNull();
  });

  it('keeps the ingredient count on a meal card — a meal has its OWN ingredients', async () => {
    const user = userEvent.setup();
    seed([APPLE, SUNDAY_ROAST]);
    render(RecipeListPage);

    await pickKind(user, 'meal');

    // Nothing is aggregated from the components: the 4 here is the roast's own
    // ingredient list, and the count means what it means on every other card.
    expect(screen.getByTestId('recipe-list-item').textContent).toContain('4');
  });

  it('offers an empty Meals section rather than hiding it', async () => {
    const user = userEvent.setup();
    seed([APPLE, BANANA]);
    render(RecipeListPage);

    await pickKind(user, 'meal');

    expect(screen.queryByTestId('recipe-list')).toBeNull();
    expect(normalized(screen.getByTestId('recipe-kind-empty'))).toContain('No meals yet');
    expect(normalized(screen.getByTestId('recipe-result-count'))).toContain('0 meals');
  });

  it('offers no way to create a meal — a recipe BECOMES one', async () => {
    const user = userEvent.setup();
    seed([APPLE]);
    render(RecipeListPage);

    await user.click(screen.getByTestId('recipe-new-btn'));

    // The New menu is still derived from the creatable KINDS, which Meals is not.
    // An empty meal would just be a recipe under another name.
    expect(screen.queryByTestId('recipe-new-meal')).toBeNull();
    expect(screen.getByTestId('recipe-new-outing')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-new-cocktail')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-new-placeholder')).toBeInTheDocument();
  });
});

// ─── Import from photo (issue #649) ───────────────────────────────────────────
// The list page owns only the way in and the way out; capture, framing and the
// extraction call belong to RecipeImportPhotoDialog (covered by its own suite).

describe('RecipeListPage — import from photo', () => {
  beforeEach(() => {
    vi.mocked(URL).createObjectURL = vi.fn(() => 'blob:page-1');
    vi.mocked(URL).revokeObjectURL = vi.fn();
    setNextCrop('stub-cropped-base64');
  });

  it('offers photo import in the New menu and opens the capture dialog', async () => {
    const user = userEvent.setup();
    seed([APPLE]);
    render(RecipeListPage);

    expect(screen.queryByTestId('recipe-import-photo-dialog')).toBeNull();

    await user.click(screen.getByTestId('recipe-new-btn'));
    await user.click(screen.getByTestId('recipe-new-import-photo'));

    expect(await screen.findByTestId('recipe-import-photo-dialog')).toBeInTheDocument();
  });

  it('offers photo import as a peer of URL import in the empty state', async () => {
    const user = userEvent.setup();
    seed([]);
    render(RecipeListPage);

    // An empty library is exactly where someone stands holding a cookbook, so
    // the two imports are offered side by side rather than one being buried.
    expect(screen.getByTestId('recipe-import-url-toggle-empty')).toBeInTheDocument();
    await user.click(screen.getByTestId('recipe-import-photo-toggle-empty'));

    expect(await screen.findByTestId('recipe-import-photo-dialog')).toBeInTheDocument();
  });

  it('stashes the draft and opens the saved recipe’s editor on success', async () => {
    const user = userEvent.setup();
    const { push } = await import('svelte-spa-router');
    const draft = { ...APPLE, id: 'imported-9' };
    vi.mocked(importRecipeFromPhoto).mockResolvedValue({ kind: 'ok', value: draft });
    seed([APPLE]);
    render(RecipeListPage);

    await user.click(screen.getByTestId('recipe-new-btn'));
    await user.click(screen.getByTestId('recipe-new-import-photo'));
    await user.upload(
      await screen.findByTestId('recipe-import-photo-input'),
      new File(['bytes'], 'page.jpg', { type: 'image/jpeg' }),
    );
    await user.click(await screen.findByTestId('recipe-import-photo-use'));
    await user.click(await screen.findByTestId('recipe-import-photo-btn'));

    // The callable already persisted the recipe flagged as not yet reviewed
    // (issue #616), so this opens THAT recipe's editor — never /recipes/new.
    await waitFor(() => expect(stashImportedDraft).toHaveBeenCalledWith(draft));
    expect(push).toHaveBeenCalledWith('/recipes/imported-9/edit');
  });
});
