import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { DomainError } from '@salt/shared-types';
import type { Recipe, Ingredient, IngredientGroup } from '@salt/domain';

// Stable, gated report() spy — delegates to the REAL category gate so suppressed
// write failures genuinely no-op (see canonService.errorReporting.test.ts).
const { reportSpy } = vi.hoisted(() => ({ reportSpy: vi.fn() }));

vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    isReportableCategory: actual.isReportableCategory,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        reportSpy(error, category);
      },
    })),
  };
});

vi.mock('@salt/firebase-sync', () => ({
  subscribeRecipes: vi.fn(() => vi.fn()),
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callParseRecipeIngredients: vi.fn(),
  callCanonicaliseRecipeIngredients: vi.fn(),
  callExtractRecipeFromUrl: vi.fn(),
  saveShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  isAuthTransitioning: vi.fn(() => false),
}));

const { mockGetCanonItemsSnapshot } = vi.hoisted(() => ({
  mockGetCanonItemsSnapshot: vi.fn(() => [] as import('@salt/domain').CanonItem[]),
}));
vi.mock('../src/lib/canonService.js', () => ({
  getCanonItemsSnapshot: mockGetCanonItemsSnapshot,
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  persistRecipe,
  removeRecipe,
  matchIngredient,
  canonicaliseIngredients,
  commitRecipeAddPlan,
  type RecipeAddRow,
} from '../src/lib/recipeService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const STORAGE_ERR: DomainError = { kind: 'StorageError', reason: 'unavailable' };
const SYNC_ERR: DomainError = { kind: 'SyncError', reason: 'push-failed' };
const NETWORK_ERR: DomainError = { kind: 'NetworkError', reason: 'offline' };
const CONFLICT_ERR: DomainError = { kind: 'ConflictError' };

function makeRecipe(groups: IngredientGroup[] = []): Recipe {
  return {
    id: 'recipe-1',
    schemaVersion: 1,
    title: 'Test',
    description: null,
    ingredients: groups,
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeIngredient(id: string): Ingredient {
  return {
    id,
    rawText: '2 eggs',
    parsed: null,
    canonId: null,
    matchState: 'pending',
    isOptional: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  reportSpy.mockReset();
  fs.saveRecipe.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.deleteRecipe.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  mockGetCanonItemsSnapshot.mockReturnValue([]);
});

describe('recipeService — write/command failure reporting (Phase 2)', () => {
  describe('persistRecipe', () => {
    it('reports a StorageError save failure', async () => {
      fs.saveRecipe.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await persistRecipe(makeRecipe());
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT surface a ConflictError save failure (gate suppresses)', async () => {
      fs.saveRecipe.mockResolvedValueOnce({ kind: 'err', error: CONFLICT_ERR });
      await persistRecipe(makeRecipe());
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });

  describe('removeRecipe', () => {
    it('reports a SyncError delete failure', async () => {
      fs.deleteRecipe.mockResolvedValueOnce({ kind: 'err', error: SYNC_ERR });
      await removeRecipe('recipe-1');
      expect(reportSpy).toHaveBeenCalledWith(SYNC_ERR, 'SyncError');
    });
  });

  describe('matchIngredient (parse + canonicalise AI callables)', () => {
    it('reports a StorageError parse failure', async () => {
      fs.callParseRecipeIngredients.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await matchIngredient(makeIngredient('a'));
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT surface a NetworkError parse failure (gate suppresses)', async () => {
      fs.callParseRecipeIngredients.mockResolvedValueOnce({ kind: 'err', error: NETWORK_ERR });
      await matchIngredient(makeIngredient('a'));
      expect(reportSpy).not.toHaveBeenCalled();
    });

    it('reports a StorageError canonicalise failure after a successful parse', async () => {
      fs.callParseRecipeIngredients.mockResolvedValueOnce({
        kind: 'ok',
        value: [
          {
            heading: null,
            items: [
              { ...makeIngredient('a'), parsed: { item: 'egg', quantity: null, unit: null } },
            ],
          } as unknown as IngredientGroup,
        ],
      });
      fs.callCanonicaliseRecipeIngredients.mockResolvedValueOnce({
        kind: 'err',
        error: STORAGE_ERR,
      });
      await matchIngredient(makeIngredient('a'));
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });
  });

  describe('canonicaliseIngredients (batch AI callable)', () => {
    it('reports a StorageError batch failure', async () => {
      const recipe = makeRecipe([
        {
          heading: null,
          items: [{ ...makeIngredient('a'), parsed: { item: 'egg', quantity: null, unit: null } }],
        } as unknown as IngredientGroup,
      ]);
      fs.callCanonicaliseRecipeIngredients.mockResolvedValueOnce({
        kind: 'err',
        error: STORAGE_ERR,
      });
      await canonicaliseIngredients(recipe);
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });
  });

  describe('commitRecipeAddPlan (shopping-list item writes)', () => {
    const row: RecipeAddRow = {
      ingredientId: 'a',
      rawText: '2 eggs',
      itemText: 'eggs',
      notes: '',
      name: 'eggs',
      fromCanon: false,
      isOptional: false,
      canonId: null,
      matched: false,
      add: true,
      check: false,
    };

    it('reports the first StorageError item-write failure', async () => {
      fs.saveShoppingListItem.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await commitRecipeAddPlan(makeRecipe(), 'list-1', 1, [row]);
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT report when all item writes succeed', async () => {
      fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
      await commitRecipeAddPlan(makeRecipe(), 'list-1', 1, [row]);
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });
});
