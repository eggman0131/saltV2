import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyIngredientGroup, newIngredient } from '@salt/domain';
import type { Recipe } from '@salt/domain';

// The editor, opened on a kind (issue #637). Three things are load-bearing here:
// the sections an entry gets follow the CAPABILITY predicates rather than the
// kind, an unrecognised kind in the URL degrades to an ordinary new recipe
// instead of persisting a value nothing downstream can read, and /recipes/new is
// byte-identical to what it was. The last one is also proved elsewhere — the
// three older RecipeEditPage suites and recipe-crud.spec.ts pass unedited — but
// asserting it here puts the claim next to the change that could break it.

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

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'entry-1',
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Carbonara',
    description: null,
    ingredients: [
      { ...emptyIngredientGroup('group-1'), items: [newIngredient('ing-1', '2 eggs')] },
    ],
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
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recipe;
}

// The three cooking-only fields, by testid. Present together or not at all.
function detailInputs(): (HTMLElement | null)[] {
  return [
    screen.queryByTestId('recipe-servings-input'),
    screen.queryByTestId('recipe-prep-input'),
    screen.queryByTestId('recipe-cook-input'),
    screen.queryByTestId('recipe-total-input'),
  ];
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockCanonItems._set([]);
  mockRecipes._set([]);
  vi.clearAllMocks();
});

describe('RecipeEditPage — /recipes/new/:kind', () => {
  it('offers no ingredients, no method and no timings for an outing', () => {
    render(RecipeEditPage, { props: { params: { kind: 'outing' } } });

    // Title and description are the whole form: that is the entire point of
    // "When you CBA" — you write it once and never think about it again.
    expect(screen.getByTestId('recipe-title-input')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-description-input')).toBeInTheDocument();

    expect(screen.queryByText('Ingredients')).toBeNull();
    expect(screen.queryByTestId('recipe-add-group-btn')).toBeNull();
    expect(screen.queryByTestId('recipe-parse-toggle-btn')).toBeNull();
    expect(screen.queryByText('Method')).toBeNull();
    expect(screen.queryByTestId('recipe-add-step-btn')).toBeNull();
    for (const input of detailInputs()) expect(input).toBeNull();
  });

  it('titles the page for the kind it is creating', () => {
    render(RecipeEditPage, { props: { params: { kind: 'outing' } } });
    expect(screen.getByText('New — When you CBA')).toBeInTheDocument();
  });

  it('persists the kind so the entry lands in its own section', async () => {
    render(RecipeEditPage, { props: { params: { kind: 'outing' } } });

    await userEvent.type(screen.getByTestId('recipe-title-input'), 'Takeaway — Indian');
    await userEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(persistRecipe).mock.calls[0]![0];
    expect(saved.kind).toBe('outing');
    expect(saved.title).toBe('Takeaway — Indian');
  });

  it('falls back to a normal new recipe when the kind segment is not a kind', async () => {
    // A URL is user input. /recipes/new/pudding must not crash and must not
    // write a document carrying a kind no predicate can answer for.
    render(RecipeEditPage, { props: { params: { kind: 'pudding' } } });

    expect(screen.getByText('New recipe')).toBeInTheDocument();
    expect(screen.getByText('Ingredients')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    for (const input of detailInputs()) expect(input).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('recipe-title-input'), 'Not a pudding');
    await userEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(persistRecipe).mock.calls[0]![0].kind).toBe('recipe');
  });

  it('leaves /recipes/new exactly as it was', async () => {
    render(RecipeEditPage, { props: { params: undefined } });

    expect(screen.getByText('New recipe')).toBeInTheDocument();
    expect(screen.getByText('Ingredients')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    for (const input of detailInputs()) expect(input).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('recipe-title-input'), 'Plain recipe');
    await userEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(persistRecipe).mock.calls[0]![0].kind).toBe('recipe');
  });
});

describe('RecipeEditPage — /recipes/:id/edit follows the loaded entry', () => {
  it('hides the cooking sections for an outing even though the URL carries no kind', async () => {
    mockRecipes._set([
      makeRecipe({ id: 'outing-1', kind: 'outing', title: 'Picnic food', ingredients: [] }),
    ]);
    render(RecipeEditPage, { props: { params: { id: 'outing-1' } } });

    await waitFor(() => expect(screen.getByText('Edit — When you CBA')).toBeInTheDocument());
    expect(screen.queryByText('Ingredients')).toBeNull();
    expect(screen.queryByText('Method')).toBeNull();
    for (const input of detailInputs()) expect(input).toBeNull();
  });

  it('keeps every section for a recipe', async () => {
    mockRecipes._set([makeRecipe()]);
    render(RecipeEditPage, { props: { params: { id: 'entry-1' } } });

    await waitFor(() => expect(screen.getByText('Edit recipe')).toBeInTheDocument());
    expect(screen.getByText('Ingredients')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    for (const input of detailInputs()) expect(input).toBeInTheDocument();
  });

  it('never offers a way to change the kind — it is set at create and pinned', async () => {
    mockRecipes._set([makeRecipe({ id: 'outing-1', kind: 'outing', ingredients: [] })]);
    render(RecipeEditPage, { props: { params: { id: 'outing-1' } } });

    await waitFor(() => expect(screen.getByText('Edit — When you CBA')).toBeInTheDocument());
    // No control in the form offers to change it, and a save round-trip returns
    // the kind untouched — `diffRecipe` deliberately does not diff it either.
    expect(screen.queryByLabelText(/kind/i)).toBeNull();

    await userEvent.click(screen.getByTestId('recipe-save-btn'));
    await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(persistRecipe).mock.calls[0]![0].kind).toBe('outing');
  });
});
