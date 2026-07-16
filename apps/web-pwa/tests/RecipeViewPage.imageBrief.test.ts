import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';

// The regenerate dialog's brief box (issue #522, Phase 2). The brief that produced
// the current image is saved on the recipe, so the dialog opens already filled in
// — nothing to load — and whatever the user edits it to is what generates the next
// image, and is what seeds the dialog the time after that.

const { mockRecipes, mockCanonItems, mockIsLoading, mockDefaultListId, mockSessions } = vi.hoisted(
  () => {
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
      mockCanonItems: makeStore<readonly { id: string }[]>([]),
      mockIsLoading: makeStore<boolean>(false),
      mockDefaultListId: makeStore<string | null>('list-1'),
      mockSessions: makeStore<readonly unknown[]>([]),
    };
  },
);

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: { user: { email: 'cook@test' } } }));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({ defaultListId: mockDefaultListId }));
vi.mock('@salt/firebase-sync', () => ({
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));
vi.mock('../src/lib/chatService.js', () => ({
  sessions: mockSessions,
  createChatSession: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('../src/lib/clipboardImage.js', () => ({
  clipboardImageReadSupported: () => false,
  readClipboardImage: vi.fn(),
  imageFromClipboardData: vi.fn(),
}));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoading,
  removeRecipe: vi.fn(),
  canonicaliseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  authorRecipeTraced: vi.fn(),
  regenerateRecipeImage: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setRecipeImageUpload: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  buildRecipeAddPlan: vi.fn().mockReturnValue([]),
  buildMadeSubRows: vi.fn().mockReturnValue([]),
  commitRecipeAddPlan: vi.fn(),
  recipeAddPlanItemCount: vi.fn().mockReturnValue(0),
}));

import RecipeViewPage from '../src/routes/recipes/RecipeViewPage.svelte';
import { regenerateRecipeImage } from '../src/lib/recipeService.js';

const RECIPE_ID = 'recipe-1';
const BRIEF = 'Served on a rustic wooden board in warm afternoon light, shot from above.';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    title: 'Test Recipe',
    description: null,
    ingredients: [],
    steps: [],
    metadata: {
      servings: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    image: { url: 'https://example.com/hero.webp', source: 'ai' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recipe;
}

afterEach(() => {
  cleanup();
  // bits-ui Dialog toggles body styles via rAF, which jsdom never fires.
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCanonItems._set([]);
  mockIsLoading._set(false);
  mockRecipes._set([]);
});

function renderPage() {
  return render(RecipeViewPage, { props: { params: { id: RECIPE_ID } } });
}

describe('RecipeViewPage — editable image brief', () => {
  it('opens the dialog pre-filled with the brief saved beside the current image', async () => {
    mockRecipes._set([makeRecipe({ imageBrief: BRIEF })]);
    const { getByTestId, findByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-image-regenerate'));

    const box = (await findByTestId('recipe-image-regenerate-brief')) as HTMLTextAreaElement;
    // Pre-filled synchronously off the subscribed doc — no fetch, no empty frame.
    expect(box.value).toBe(BRIEF);
  });

  it('generates from the edited brief, not the original', async () => {
    mockRecipes._set([makeRecipe({ imageBrief: BRIEF })]);
    const { getByTestId, findByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-image-regenerate'));
    const box = await findByTestId('recipe-image-regenerate-brief');
    const edited = 'Served in a deep bowl in warm afternoon light, shot from above.';
    await fireEvent.input(box, { target: { value: edited } });
    await fireEvent.click(getByTestId('recipe-image-regenerate-confirm'));

    await waitFor(() => expect(regenerateRecipeImage).toHaveBeenCalledWith(RECIPE_ID, edited));
  });

  it('re-seeds from the saved brief on each open, so iteration compounds', async () => {
    // Stand in for the round trip: the trigger re-saves imageBrief after generating,
    // and the new value arrives on the subscription. The next open must show THAT —
    // the user's own edit — not the brief the dialog first opened with.
    mockRecipes._set([makeRecipe({ imageBrief: BRIEF })]);
    const { getByTestId, findByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-image-regenerate'));
    expect(
      ((await findByTestId('recipe-image-regenerate-brief')) as HTMLTextAreaElement).value,
    ).toBe(BRIEF);
    await fireEvent.click(getByTestId('recipe-image-regenerate-confirm'));

    const next = 'Served in a deep bowl, steam rising, shot from above.';
    mockRecipes._set([makeRecipe({ imageBrief: next })]);

    await fireEvent.click(getByTestId('recipe-image-regenerate'));
    await waitFor(async () =>
      expect(
        ((await findByTestId('recipe-image-regenerate-brief')) as HTMLTextAreaElement).value,
      ).toBe(next),
    );
  });

  it('shows an empty box and generates with no brief for a recipe that has none', async () => {
    // Nothing changes for existing recipes until you ask: no brief on the doc means
    // an empty optional box (no error, no spinner) and an omitted brief on the call,
    // which is what routes the trigger back to authoring one.
    mockRecipes._set([makeRecipe()]);
    const { getByTestId, findByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-image-regenerate'));
    const box = (await findByTestId('recipe-image-regenerate-brief')) as HTMLTextAreaElement;
    expect(box.value).toBe('');

    await fireEvent.click(getByTestId('recipe-image-regenerate-confirm'));
    await waitFor(() => expect(regenerateRecipeImage).toHaveBeenCalledWith(RECIPE_ID, undefined));
  });

  it('treats a brief the user emptied as "author me a fresh one"', async () => {
    mockRecipes._set([makeRecipe({ imageBrief: BRIEF })]);
    const { getByTestId, findByTestId } = renderPage();

    await fireEvent.click(getByTestId('recipe-image-regenerate'));
    await fireEvent.input(await findByTestId('recipe-image-regenerate-brief'), {
      target: { value: '   ' },
    });
    await fireEvent.click(getByTestId('recipe-image-regenerate-confirm'));

    await waitFor(() => expect(regenerateRecipeImage).toHaveBeenCalledWith(RECIPE_ID, undefined));
  });
});
