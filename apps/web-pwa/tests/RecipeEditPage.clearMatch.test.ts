import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { newIngredient, emptyIngredientGroup } from '@salt/domain';
import type { Recipe, Ingredient } from '@salt/domain';

// ─── Mock stores and services ──────────────────────────────────────────────────

const { mockRecipes } = vi.hoisted(() => {
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
  return { mockRecipes: makeStore<readonly Recipe[]>([]) };
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
}));

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';
import { persistRecipe } from '../src/lib/recipeService.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMatchedIngredient(): Ingredient {
  return {
    ...newIngredient('ing-1', 'garlic'),
    canonId: 'canon-abc',
    matchState: 'matched',
    parsed: {
      quantity: null,
      unit: null,
      item: 'garlic',
      preparation: [],
      notes: null,
      displayText: null,
    },
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecipeEditPage — clearIngredientMatch on edit', () => {
  it('clears canonId and sets matchState pending when ingredient text changes', async () => {
    mockRecipes._set([makeRecipe(makeMatchedIngredient())]);
    render(RecipeEditPage, { props: { params: { id: 'recipe-1' } } });

    const input = screen.getByTestId('recipe-ingredient-input');
    await userEvent.type(input, ' minced');

    await userEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => {
      expect(vi.mocked(persistRecipe)).toHaveBeenCalledTimes(1);
    });

    const saved = vi.mocked(persistRecipe).mock.calls[0]![0] as Recipe;
    const ingredient = saved.ingredients[0]!.items[0]!;
    expect(ingredient.matchState).toBe('pending');
    expect(ingredient.canonId).toBeNull();
  });

  it('preserves existing match when ingredient text is not changed', async () => {
    mockRecipes._set([makeRecipe(makeMatchedIngredient())]);
    render(RecipeEditPage, { props: { params: { id: 'recipe-1' } } });

    await userEvent.click(screen.getByTestId('recipe-save-btn'));

    await waitFor(() => {
      expect(vi.mocked(persistRecipe)).toHaveBeenCalledTimes(1);
    });

    const saved = vi.mocked(persistRecipe).mock.calls[0]![0] as Recipe;
    const ingredient = saved.ingredients[0]!.items[0]!;
    expect(ingredient.matchState).toBe('matched');
    expect(ingredient.canonId).toBe('canon-abc');
  });
});
