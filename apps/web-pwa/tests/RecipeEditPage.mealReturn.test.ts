import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';

// Saving a dish that a meal sent you to write (issue #752, Phase 3).
//
// The editor is the far end of three of the four create paths — by hand, and
// both imports, which persist server-side first and arrive at
// `/recipes/{id}/edit?meal=…`. What is pinned here is the whole contract of that
// landing: the meal comes from the URL, the attach is gated on the PARAM rather
// than on "is this a create", and a meal that has since been deleted must not
// cost the user the recipe they just wrote.

const { mockRecipes, mockCanonItems, mockRouter } = vi.hoisted(() => {
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
    // The router's `querystring` stands in for the address bar. Setting it is how
    // this suite says "you got here from a meal" — there is nowhere else the id
    // could come from, which is the point of the phase.
    mockRouter: { querystring: undefined as string | undefined },
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn(), router: mockRouter }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  attachComponentToMeal: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  parseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  takeImportedDraft: vi.fn().mockReturnValue(null),
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';
import { attachComponentToMeal, persistRecipe } from '../src/lib/recipeService.js';
import { addToast } from '../src/lib/toastStore.js';
import { push } from 'svelte-spa-router';

const MEAL_ID = 'roast';

function makeRecipe(overrides: Partial<Recipe> & { id: string; title: string }): Recipe {
  return {
    schemaVersion: 1,
    kind: 'recipe',
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
    producesCanonId: null,
    componentRecipeIds: [],
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recipe;
}

const ROAST = makeRecipe({ id: MEAL_ID, title: 'Sunday roast' });
const IMPORTED = makeRecipe({ id: 'imported-9', title: 'Onion gravy' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRouter.querystring = undefined;
  mockCanonItems._set([]);
  mockRecipes._set([ROAST, IMPORTED]);
  vi.mocked(persistRecipe).mockResolvedValue({ kind: 'ok', value: undefined });
  vi.mocked(attachComponentToMeal).mockResolvedValue({ kind: 'ok', value: undefined });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** Open the blank editor (the by-hand path) and give it a title. */
async function createByHand(title = 'Onion gravy'): Promise<void> {
  render(RecipeEditPage, { props: {} });
  await waitFor(() => expect(screen.getByTestId('recipe-title-input')).toBeInTheDocument());
  // `fireEvent`, not `userEvent`: keystrokes get eaten by bits-ui focus traps in
  // these suites, and this only needs the value in place.
  await fireEvent.input(screen.getByTestId('recipe-title-input'), { target: { value: title } });
}

function savedId(): string {
  return vi.mocked(persistRecipe).mock.calls[0]![0].id;
}

describe('RecipeEditPage — a dish written for a meal', () => {
  it('attaches the new dish to the meal and lands back on the meal', async () => {
    mockRouter.querystring = `meal=${MEAL_ID}`;
    await createByHand();

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    // The dish is saved on its own first — it is a recipe like any other — and
    // only then hung off the meal.
    expect(attachComponentToMeal).toHaveBeenCalledWith(MEAL_ID, savedId());
    // …and the round trip ends where it began: the meal, not the new dish.
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/recipes/${MEAL_ID}`));
    expect(push).not.toHaveBeenCalledWith(`/recipes/${savedId()}`);
    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/added to the meal/i), 'success');
  });

  it('behaves exactly as before when no meal sent us here', async () => {
    await createByHand();

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    expect(attachComponentToMeal).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/recipes/${savedId()}`);
  });

  it('attaches on an EDIT save too — the imports land on /recipes/:id/edit', async () => {
    // The non-obvious half of the contract. URL and photo import both persist
    // server-side before the editor opens, so two of the four paths arrive on an
    // edit route; a first-save gate would silently skip them. Presence of the
    // param is the intent, and the attach is idempotent, so this is safe.
    mockRouter.querystring = `meal=${MEAL_ID}`;
    render(RecipeEditPage, { props: { params: { id: IMPORTED.id } } });
    await waitFor(() =>
      expect(screen.getByTestId('recipe-title-input')).toHaveValue('Onion gravy'),
    );

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(attachComponentToMeal).toHaveBeenCalledWith(MEAL_ID, IMPORTED.id));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/recipes/${MEAL_ID}`));
  });

  it('keeps the recipe, and says so, when the meal has been deleted meanwhile', async () => {
    mockRouter.querystring = `meal=${MEAL_ID}`;
    vi.mocked(attachComponentToMeal).mockResolvedValue({
      kind: 'err',
      error: { kind: 'NotFound', resource: 'recipe', id: MEAL_ID },
    });
    await createByHand();

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    // The dish was written and must not be lost to a failed attach: the user is
    // told the truth and lands on what they just made.
    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/recipes/${savedId()}`));
    expect(push).not.toHaveBeenCalledWith(`/recipes/${MEAL_ID}`);
    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/no longer/i), 'destructive');
  });

  it('never attaches when the save itself failed', async () => {
    mockRouter.querystring = `meal=${MEAL_ID}`;
    vi.mocked(persistRecipe).mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });
    await createByHand();

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith('Failed to save recipe.', 'destructive'),
    );
    expect(attachComponentToMeal).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('ignores a blank meal parameter', async () => {
    // `?meal=` is a URL someone can type. It must read as "no meal", not as an
    // attach to a document with an empty id.
    mockRouter.querystring = 'meal=';
    await createByHand();

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    expect(attachComponentToMeal).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/recipes/${savedId()}`);
  });
});
