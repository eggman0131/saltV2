import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyIngredientGroup, newIngredient } from '@salt/domain';
import type { Recipe } from '@salt/domain';

// The editor's Servings field (issue #1123). It shares `parseNumberOrNull` with
// the three time fields, where 0 is a real answer (issue #739) — here it is not,
// and a stored 0 was the value `buildRecipeAddPlan` used to divide by. So the
// fold to `null` ("not stated", the field's existing sentinel) happens at this
// call site and must NOT reach the time fields, which is the second half of what
// this suite pins.

const { mockRecipes, mockCanonItems } = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockCanonItems: makeStore<readonly { id: string }[]>([]),
  };
});

vi.mock('svelte-spa-router', () => ({
  push: vi.fn(),
  router: { querystring: undefined },
}));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  parseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  takeImportedDraft: vi.fn().mockReturnValue(null),
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/featureGate.js', () => ({
  breadGate: {
    subscribe: (fn: (v: unknown) => void) => (fn({ enabled: true, settled: true }), () => {}),
  },
  featureGate: () => ({
    subscribe: (fn: (v: unknown) => void) => (fn({ enabled: true, settled: true }), () => {}),
  }),
  isFeatureEnabled: () => true,
}));

import RecipeEditPage from '../src/routes/recipes/RecipeEditPage.svelte';
import { persistRecipe } from '../src/lib/recipeService.js';

function makeRecipe(): Recipe {
  return {
    lastEditedBy: '',
    createdBy: '',
    producesCanonId: null,
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
      servings: 4,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    componentRecipeIds: [],
    kit: [],
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function typeInto(testId: string, value: string): Promise<void> {
  const field = screen.getByTestId(testId);
  await userEvent.clear(field);
  if (value !== '') await userEvent.type(field, value);
}

async function savedRecipe(): Promise<Recipe> {
  await userEvent.click(screen.getByTestId('recipe-save-btn'));
  await waitFor(() => expect(persistRecipe).toHaveBeenCalledTimes(1));
  return vi.mocked(persistRecipe).mock.calls[0]![0];
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockCanonItems._set([]);
  mockRecipes._set([]);
  vi.clearAllMocks();
});

describe('RecipeEditPage — Servings', () => {
  it('stores a typed 0 as null — "serves nobody" is not an answer, it is no answer', async () => {
    mockRecipes._set([makeRecipe()]);
    render(RecipeEditPage, { props: { params: { id: 'entry-1' } } });

    await typeInto('recipe-servings-input', '0');

    expect((await savedRecipe()).metadata.servings).toBeNull();
  });

  it('stores a real count unchanged', async () => {
    mockRecipes._set([makeRecipe()]);
    render(RecipeEditPage, { props: { params: { id: 'entry-1' } } });

    await typeInto('recipe-servings-input', '6');

    expect((await savedRecipe()).metadata.servings).toBe(6);
  });

  // The #739 half of this — a typed 0 that IS a real answer — moved with the
  // boxes it was asserted through: issue #1233 retired Prep/Cook/Total, and the
  // remaining `parseNumberOrNull` callers are the phase minute figures, pinned in
  // `RecipeEditPage.phases.test.ts`.
});
