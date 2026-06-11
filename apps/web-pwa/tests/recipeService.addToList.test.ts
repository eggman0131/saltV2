import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { Recipe, CanonItem, IngredientGroup } from '@salt/domain';

// ─── Mock firebase-sync ──────────────────────────────────────────────────────
vi.mock('@salt/firebase-sync', () => ({
  subscribeRecipes: vi.fn(() => vi.fn()),
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callParseRecipeIngredients: vi.fn(),
  callCanonicaliseRecipeIngredients: vi.fn(),
  saveShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

vi.mock('@salt/ld-observability', () => ({
  createLDErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

// ─── Mock canonService ───────────────────────────────────────────────────────
const { mockGetCanonItemsSnapshot } = vi.hoisted(() => ({
  mockGetCanonItemsSnapshot: vi.fn(() => [] as CanonItem[]),
}));

vi.mock('../src/lib/canonService.js', () => ({
  getCanonItemsSnapshot: mockGetCanonItemsSnapshot,
}));

import * as firebaseSync from '@salt/firebase-sync';
import { addRecipeToShoppingList } from '../src/lib/recipeService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCanonItem(id: string): CanonItem {
  return {
    id,
    schemaVersion: 2,
    name: id,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
  };
}

function makeGroup(items: IngredientGroup['items']): IngredientGroup {
  return { id: 'g1', name: null, items };
}

function makeRecipe(groups: IngredientGroup[]): Recipe {
  return {
    id: 'recipe-1',
    schemaVersion: 1,
    title: 'Test Recipe',
    description: null,
    ingredients: groups,
    steps: [],
    metadata: {
      servings: 2,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const parsedIngredient = {
  quantity: { type: 'single' as const, value: 2 },
  unit: 'cups',
  item: 'flour',
  preparation: [],
  notes: null,
  convertedWeight: null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  mockGetCanonItemsSnapshot.mockReturnValue([]);
});

describe('addRecipeToShoppingList', () => {
  it('adds a matched ingredient with canonId when the canon item is live', async () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour')]);

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: '2 cups flour',
          parsed: parsedIngredient,
          canonId: 'canon-flour',
          matchState: 'matched',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    const result = await addRecipeToShoppingList(recipe, 'list-1', 2);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(fs.saveShoppingListItem).toHaveBeenCalledOnce();
    const savedItem = (fs.saveShoppingListItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(savedItem.canonId).toBe('canon-flour');
    expect(savedItem.matchState).toBe('matched');
  });

  it('adds a dangling-matched ingredient as raw text when the canon item is absent from the store', async () => {
    // canon store is empty — 'canon-flour' was deleted
    mockGetCanonItemsSnapshot.mockReturnValue([]);

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: '2 cups flour',
          parsed: parsedIngredient,
          canonId: 'canon-flour',
          matchState: 'matched',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    const result = await addRecipeToShoppingList(recipe, 'list-1', 2);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(fs.saveShoppingListItem).toHaveBeenCalledOnce();
    const savedItem = (fs.saveShoppingListItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // Dangling ingredient: falls back to raw text (no live canon match).
    expect(savedItem.canonId).toBeNull();
    expect(savedItem.matchState).toBe('pending');
    expect(savedItem.rawText).toBe('2 cups flour');
  });

  it('adds an unmatched ingredient as raw text', async () => {
    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: 'some unknown thing',
          parsed: null,
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    await addRecipeToShoppingList(recipe, 'list-1', 2);

    const savedItem = (fs.saveShoppingListItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(savedItem.canonId).toBeNull();
    expect(savedItem.matchState).toBe('pending');
    expect(savedItem.rawText).toBe('some unknown thing');
  });
});
