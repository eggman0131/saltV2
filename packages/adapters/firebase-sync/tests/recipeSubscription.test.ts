import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUnsubscribe,
  mockOnSnapshot,
  mockSetDoc,
  mockDeleteDoc,
  mockGetDoc,
  mockDoc,
  mockCollection,
  mockGetFirestore,
} = vi.hoisted(() => ({
  mockUnsubscribe: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockSetDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
  mockGetDoc: vi.fn(),
  mockDoc: vi.fn(() => 'mock-doc-ref'),
  mockCollection: vi.fn(() => 'mock-collection-ref'),
  mockGetFirestore: vi.fn(() => 'mock-db'),
}));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: mockCollection,
  doc: mockDoc,
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  getDoc: mockGetDoc,
}));

import {
  subscribeRecipes,
  loadRecipe,
  saveRecipe,
  deleteRecipe,
} from '../src/recipeSubscription.js';
import type { Recipe } from '@salt/domain';
import { emptyRecipe } from '@salt/domain';

type SnapDoc = { id: string; data: () => unknown };
type CollectionCallback = (snap: { docs: SnapDoc[] }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

const RECIPE: Recipe = {
  ...emptyRecipe('recipe-1', '2026-06-11T10:00:00.000Z'),
  title: 'Round-trip Recipe',
  ingredients: [
    {
      id: 'grp-1',
      name: 'For the sauce',
      items: [
        {
          id: 'ing-1',
          rawText: '1 ½ cups passata',
          parsed: {
            quantity: { type: 'single', value: 360 },
            unit: 'ml',
            item: 'passata',
            preparation: [],
            notes: null,
            displayText: '1½ cups',
          },
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ],
    },
  ],
  updatedAt: '2026-06-11T10:05:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('subscribeRecipes', () => {
  it('targets the recipes collection and returns the unsubscribe', () => {
    const unsub = subscribeRecipes(
      () => {},
      () => {},
    );
    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'recipes');
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('maps valid docs and skips+logs invalid ones (list-read contract)', () => {
    const onRecipes = vi.fn();
    subscribeRecipes(onRecipes, () => {});
    (mockOnSnapshot.mock.calls[0][1] as CollectionCallback)({
      docs: [
        { id: 'recipe-1', data: () => RECIPE },
        { id: 'bad', data: () => ({ id: 'bad', schemaVersion: 1 }) },
      ],
    });
    const [received] = onRecipes.mock.calls[0] as [Recipe[]];
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(RECIPE);
    expect(console.error).toHaveBeenCalled();
  });

  it('classifies stream-level errors', () => {
    const onError = vi.fn();
    subscribeRecipes(() => {}, onError);
    (mockOnSnapshot.mock.calls[0][2] as ErrorCallback)(
      Object.assign(new Error('e'), { code: 'permission-denied' }),
    );
    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' });
  });
});

describe('loadRecipe', () => {
  it('targets recipes/{id} and returns the recipe', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => RECIPE });
    const result = await loadRecipe('recipe-1');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'recipes', 'recipe-1');
    expect(result).toEqual({ kind: 'ok', value: RECIPE });
  });

  it('returns null when the recipe does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    const result = await loadRecipe('missing');
    expect(result).toEqual({ kind: 'ok', value: null });
  });

  it('returns a corruption Failure on an invalid doc (single-doc-read contract)', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ id: 'x', schemaVersion: 2 }),
    });
    const result = await loadRecipe('recipe-1');
    expect(result).toEqual({ kind: 'err', error: { kind: 'StorageError', reason: 'corruption' } });
  });

  it('returns failure (never throws) on a Firestore error', async () => {
    mockGetDoc.mockRejectedValue(Object.assign(new Error('e'), { code: 'unavailable' }));
    const result = await loadRecipe('recipe-1');
    expect(result.kind).toBe('err');
  });
});

describe('saveRecipe', () => {
  it('writes to recipes/{id} keyed by recipe.id', async () => {
    const result = await saveRecipe(RECIPE);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'recipes', 'recipe-1');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...RECIPE });
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure (never throws) on a Firestore error', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('e'), { code: 'permission-denied' }));
    const result = await saveRecipe(RECIPE);
    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });
});

describe('deleteRecipe', () => {
  it('deletes recipes/{id}', async () => {
    const result = await deleteRecipe('recipe-1');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'recipes', 'recipe-1');
    expect(mockDeleteDoc).toHaveBeenCalledWith('mock-doc-ref');
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure (never throws) on a Firestore error', async () => {
    mockDeleteDoc.mockRejectedValue(Object.assign(new Error('e'), { code: 'unavailable' }));
    const result = await deleteRecipe('recipe-1');
    expect(result.kind).toBe('err');
  });
});
