import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { newIngredient, emptyIngredientGroup } from '@salt/domain';
import type { Recipe, Ingredient } from '@salt/domain';

// ─── Mock stores and services ──────────────────────────────────────────────────

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
// RecipeEditPage is wrapped in AdminGuard (#179); seed an admin context so the
// guard renders the form under test.
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: { user: { email: 'admin@test' } } }));
vi.mock('../src/lib/membersService.js', () => {
  const readable = <T>(v: T) => ({
    subscribe(fn: (x: T) => void) {
      fn(v);
      return () => {};
    },
  });
  return {
    members: readable([{ email: 'admin@test', admin: true }]),
    isLoadingMembers: readable(false),
  };
});
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  parseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';
import { persistRecipe, matchIngredient } from '../src/lib/recipeService.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePendingIngredient(): Ingredient {
  return {
    ...newIngredient('ing-1', '2 cups flour'),
    parsed: null,
    canonId: null,
    matchState: 'pending',
  };
}

function makeRecipe(ing: Ingredient): Recipe {
  return {
    id: 'recipe-1',
    schemaVersion: 1,
    title: 'Test Recipe',
    description: null,
    ingredients: [{ ...emptyIngredientGroup('group-1'), items: [ing] }],
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
  };
}

const matchedIngredient: Ingredient = {
  id: 'ing-1',
  rawText: '2 cups flour',
  parsed: {
    quantity: { type: 'single', value: 240 },
    unit: 'g',
    item: 'flour',
    preparation: [],
    notes: null,
    displayText: '2 cups',
  },
  canonId: 'canon-flour',
  matchState: 'matched',
  isOptional: false,
  firstUsedInStepId: null,
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockCanonItems._set([]);
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecipeEditPage — per-row Match button', () => {
  it('clears the unmatched indicator after clicking it on a pending ingredient', async () => {
    vi.mocked(matchIngredient).mockResolvedValue({ kind: 'ok', value: matchedIngredient });
    mockCanonItems._set([{ id: 'canon-flour' }]);
    mockRecipes._set([makeRecipe(makePendingIngredient())]);
    render(RecipeEditPage, { props: { params: { id: 'recipe-1' } } });

    // A pending, non-blank ingredient shows the clickable unmatched cross up front.
    expect(screen.getByTestId('recipe-ingredient-match-btn')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('recipe-ingredient-match-btn'));

    // Once matched the indicator (which is also the trigger) disappears.
    await waitFor(() => {
      expect(screen.queryByTestId('recipe-ingredient-match-btn')).not.toBeInTheDocument();
    });
  });

  it('persists the matched ingredient (canonId + matchState) on save', async () => {
    vi.mocked(matchIngredient).mockResolvedValue({ kind: 'ok', value: matchedIngredient });
    mockCanonItems._set([{ id: 'canon-flour' }]);
    mockRecipes._set([makeRecipe(makePendingIngredient())]);
    render(RecipeEditPage, { props: { params: { id: 'recipe-1' } } });

    await userEvent.click(screen.getByTestId('recipe-ingredient-match-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('recipe-ingredient-match-btn')).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('recipe-save-btn'));
    await waitFor(() => {
      expect(vi.mocked(persistRecipe)).toHaveBeenCalledTimes(1);
    });

    const saved = vi.mocked(persistRecipe).mock.calls[0]![0] as Recipe;
    const ing = saved.ingredients[0]!.items[0]!;
    expect(ing.matchState).toBe('matched');
    expect(ing.canonId).toBe('canon-flour');
  });

  it('keeps the unmatched indicator when matchIngredient returns failed', async () => {
    const failedIngredient: Ingredient = {
      ...makePendingIngredient(),
      matchState: 'failed',
    };
    vi.mocked(matchIngredient).mockResolvedValue({ kind: 'ok', value: failedIngredient });
    mockRecipes._set([makeRecipe(makePendingIngredient())]);
    render(RecipeEditPage, { props: { params: { id: 'recipe-1' } } });

    await userEvent.click(screen.getByTestId('recipe-ingredient-match-btn'));

    // A failed match is still unmatched, so the clickable cross remains.
    await waitFor(() => {
      expect(vi.mocked(matchIngredient)).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('recipe-ingredient-match-btn')).toBeInTheDocument();
  });
});
