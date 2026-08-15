import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';

// Building a meal in the editor (issue #752). A recipe BECOMES a meal by gaining
// components — there is no "new meal" and no kind to pick — so this section is the
// whole of the feature's way in.
//
// Everything here mutates the DRAFT and is written by the page's existing save
// path; there is no second write. The picker is driven with `fireEvent` rather
// than `userEvent` for the reason MealDayEditor.recipePicker.test.ts records: a
// synthetic focus shuffle can tear a bits-ui listbox down before the click lands.

const { mockRecipes, mockCanonItems } = vi.hoisted(() => {
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
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  parseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  takeImportedDraft: vi.fn().mockReturnValue(null),
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';
import { persistRecipe } from '../src/lib/recipeService.js';

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

function withCookTime(recipe: Recipe, cookTimeMinutes: number | null): Recipe {
  return { ...recipe, metadata: { ...recipe.metadata, cookTimeMinutes } };
}

const ROAST = makeRecipe({ id: MEAL_ID, title: 'Sunday roast' });
const CHICKEN = withCookTime(makeRecipe({ id: 'chicken', title: 'Roast chicken' }), 90);
const POTATOES = withCookTime(makeRecipe({ id: 'potatoes', title: 'Roast potatoes' }), 45);
const GRAVY = withCookTime(makeRecipe({ id: 'gravy', title: 'Onion gravy' }), 20);
const TAKEAWAY = makeRecipe({ id: 'takeaway', title: 'Takeaway — Indian', kind: 'outing' });
const PLACEHOLDER = makeRecipe({ id: 'stock-photo', title: 'A good dinner', kind: 'placeholder' });

const LIBRARY = [ROAST, CHICKEN, POTATOES, GRAVY, TAKEAWAY, PLACEHOLDER];

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockCanonItems._set([]);
  mockRecipes._set([]);
  vi.clearAllMocks();
});

/** Open the editor on the meal and wait for the draft to hydrate from the store. */
async function openEditor(id = MEAL_ID): Promise<void> {
  render(RecipeEditPage, { props: { params: { id } } });
  await waitFor(() => expect(screen.getByTestId('recipe-components-editor')).toBeInTheDocument());
}

async function openPicker(): Promise<void> {
  await fireEvent.click(screen.getByTestId('recipe-component-picker'));
}

async function pick(title: string): Promise<void> {
  await openPicker();
  await fireEvent.click(await screen.findByRole('option', { name: title }));
}

function rowTitles(): string[] {
  return screen
    .queryAllByTestId('recipe-component-row')
    .map((el) => el.querySelector('span.truncate')?.textContent?.trim() ?? '');
}

function savedComponents(): string[] {
  return vi.mocked(persistRecipe).mock.calls[0]![0].componentRecipeIds;
}

describe('RecipeEditPage — building a meal out of recipes', () => {
  it('offers the section on a recipe and a cocktail, and on nothing else', async () => {
    // A capability, so it comes from the domain table rather than a kind branch:
    // an outing has no dish to compose, a placeholder is a photograph and a title.
    mockRecipes._set(LIBRARY);

    await openEditor();
    expect(screen.getByTestId('recipe-components-editor')).toBeInTheDocument();

    for (const id of ['takeaway', 'stock-photo']) {
      cleanup();
      render(RecipeEditPage, { props: { params: { id } } });
      await waitFor(() => expect(screen.getByTestId('recipe-title-input')).toBeInTheDocument());
      expect(screen.queryByTestId('recipe-components-editor')).toBeNull();
    }
  });

  it('offers only dishes you make — never itself, an outing or a placeholder', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();
    await openPicker();

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Roast chicken', 'Roast potatoes', 'Onion gravy']);
  });

  it('attaches longest-cooking first, whatever order you pick them in', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    await pick('Onion gravy');
    await pick('Roast chicken');
    await pick('Roast potatoes');

    // The order you start things in: the bird before the potatoes before the gravy.
    expect(rowTitles()).toEqual(['Roast chicken', 'Roast potatoes', 'Onion gravy']);
  });

  it('drops an attached dish out of the picker so it cannot be added twice', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    await pick('Roast chicken');
    await openPicker();

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim());
    expect(options).not.toContain('Roast chicken');
  });

  it('removes a dish without touching the others', async () => {
    mockRecipes._set([{ ...ROAST, componentRecipeIds: ['chicken', 'potatoes'] }, ...LIBRARY]);
    await openEditor();
    expect(rowTitles()).toEqual(['Roast chicken', 'Roast potatoes']);

    await fireEvent.click(screen.getByTestId('recipe-component-remove-chicken'));

    expect(rowTitles()).toEqual(['Roast potatoes']);
  });

  it('skips a component deleted elsewhere rather than rendering a broken row', async () => {
    mockRecipes._set([
      { ...ROAST, componentRecipeIds: ['chicken', 'deleted-elsewhere'] },
      CHICKEN,
      GRAVY,
    ]);
    await openEditor();

    expect(rowTitles()).toEqual(['Roast chicken']);
  });

  it('writes the components through the existing save path, and nothing else', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    await pick('Roast chicken');
    await pick('Onion gravy');

    // Nothing has been written yet — the draft is the only thing that moved.
    expect(persistRecipe).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    expect(savedComponents()).toEqual(['chicken', 'gravy']);
    // The kind is untouched: a meal is not a fifth kind, it is a recipe with
    // components.
    expect(vi.mocked(persistRecipe).mock.calls[0]![0].kind).toBe('recipe');
  });

  it('keeps the meal its own ingredients and method beside the components', async () => {
    mockRecipes._set(LIBRARY);
    await openEditor();

    // Nothing is aggregated, so the editor still offers everything a recipe has.
    expect(screen.getByText('Ingredients')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-notes-input')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-tags-input')).toBeInTheDocument();
  });
});
