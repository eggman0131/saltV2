import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Recipe } from '@salt/domain';

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
  stashImportedDraft: vi.fn(),
}));

import RecipeListPage from '../src/routes/recipes/RecipeListPage.svelte';

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
}): Recipe {
  return {
    id: over.id,
    schemaVersion: 1,
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
  imageHidden: true, // hidden → fallback tile even though a url exists
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

  it('shows the hero image when present and a fallback tile otherwise', () => {
    seed([APPLE, BANANA, CARROT]);
    render(RecipeListPage);

    // Only Apple has a visible image; Banana (null) and Carrot (hidden) fall back.
    expect(screen.getAllByTestId('recipe-list-thumb')).toHaveLength(1);
    expect(screen.getAllByTestId('recipe-list-thumb-fallback')).toHaveLength(2);

    // The visible thumb is cache-busted (issue #460): Apple has no
    // `imageRequestedAt`, so the nonce falls back to `updatedAt`. The base URL
    // carries no query, so the param is appended with `?v=`.
    const src = screen.getByTestId('recipe-list-thumb').getAttribute('src');
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

    // All tags across the library are offered before any filtering.
    expect(filterTags()).toEqual(['baking', 'dessert', 'quick', 'soup']);

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
