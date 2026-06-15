import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { Recipe, CanonItem, IngredientGroup } from '@salt/domain';

// ─── Mock firebase-sync ──────────────────────────────────────────────────────
vi.mock('@salt/firebase-sync', () => ({
  subscribeRecipes: vi.fn(() => vi.fn()),
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callParseRecipeIngredients: vi.fn(),
  callCanonicaliseRecipeIngredients: vi.fn(),
}));

vi.mock('@salt/ld-observability', () => ({
  createLDErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

// ─── Mock canonService ───────────────────────────────────────────────────────
const { mockGetCanonItemsSnapshot } = vi.hoisted(() => ({
  mockGetCanonItemsSnapshot: vi.fn(() => [] as import('@salt/domain').CanonItem[]),
}));

vi.mock('../src/lib/canonService.js', () => ({
  getCanonItemsSnapshot: mockGetCanonItemsSnapshot,
}));

import * as firebaseSync from '@salt/firebase-sync';
import { canonicaliseIngredients } from '../src/lib/recipeService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCanonItem(id: string, needs_approval = false): CanonItem {
  return {
    id,
    schemaVersion: 2,
    name: id,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval,
    updatedAt: '',
  };
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

function makeGroup(items: IngredientGroup['items']): IngredientGroup {
  return { id: 'g1', name: null, items };
}

const parsedIngredient = {
  quantity: { type: 'single' as const, value: 240 },
  unit: 'g' as const,
  item: 'flour',
  preparation: [],
  notes: null,
  displayText: '2 cups',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  fs.saveRecipe.mockResolvedValue({ kind: 'ok', value: undefined });
  // Default: empty canon store (no live matches).
  mockGetCanonItemsSnapshot.mockReturnValue([]);
});

describe('canonicaliseIngredients', () => {
  it('returns success immediately when no ingredients are canonisable', async () => {
    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: '2 cups flour',
          parsed: null,
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    const result = await canonicaliseIngredients(recipe);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(fs.callCanonicaliseRecipeIngredients).not.toHaveBeenCalled();
    expect(fs.saveRecipe).not.toHaveBeenCalled();
  });

  it('sets matched + canonId when batch returns a matched item', async () => {
    const canon = makeCanonItem('canon-flour', false);
    fs.callCanonicaliseRecipeIngredients.mockResolvedValue({
      kind: 'ok',
      value: [{ kind: 'ok', value: { decision: 'matched', item: canon } }],
    });

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: '2 cups flour',
          parsed: parsedIngredient,
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    await canonicaliseIngredients(recipe);

    const saved = (fs.saveRecipe as ReturnType<typeof vi.fn>).mock.calls[0][0] as Recipe;
    const ing = saved.ingredients[0].items[0];
    expect(ing.canonId).toBe('canon-flour');
    expect(ing.matchState).toBe('matched');
  });

  it('sets matched even when the returned canon item has needs_approval = true', async () => {
    const canon = makeCanonItem('canon-novel', true);
    fs.callCanonicaliseRecipeIngredients.mockResolvedValue({
      kind: 'ok',
      value: [{ kind: 'ok', value: { decision: 'created', item: canon } }],
    });

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: 'some novel ingredient',
          parsed: { ...parsedIngredient, item: 'novel ingredient' },
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    await canonicaliseIngredients(recipe);

    const saved = (fs.saveRecipe as ReturnType<typeof vi.fn>).mock.calls[0][0] as Recipe;
    const ing = saved.ingredients[0].items[0];
    expect(ing.canonId).toBe('canon-novel');
    expect(ing.matchState).toBe('matched');
  });

  it('sets failed + null canonId when the batch item slot returns an error', async () => {
    fs.callCanonicaliseRecipeIngredients.mockResolvedValue({
      kind: 'ok',
      value: [{ kind: 'err', error: { kind: 'NetworkError', reason: 'transient' } }],
    });

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: '2 cups flour',
          parsed: parsedIngredient,
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    await canonicaliseIngredients(recipe);

    const saved = (fs.saveRecipe as ReturnType<typeof vi.fn>).mock.calls[0][0] as Recipe;
    const ing = saved.ingredients[0].items[0];
    expect(ing.canonId).toBeNull();
    expect(ing.matchState).toBe('failed');
  });

  it('retries failed ingredients (matchState failed + parsed)', async () => {
    const canon = makeCanonItem('canon-butter', false);
    fs.callCanonicaliseRecipeIngredients.mockResolvedValue({
      kind: 'ok',
      value: [{ kind: 'ok', value: { decision: 'matched', item: canon } }],
    });

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: '100g butter',
          parsed: { ...parsedIngredient, item: 'butter' },
          canonId: null,
          matchState: 'failed',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    await canonicaliseIngredients(recipe);

    expect(fs.callCanonicaliseRecipeIngredients).toHaveBeenCalledOnce();
    const saved = (fs.saveRecipe as ReturnType<typeof vi.fn>).mock.calls[0][0] as Recipe;
    expect(saved.ingredients[0].items[0].matchState).toBe('matched');
  });

  it('skips ingredients whose canonId is live in the canon store', async () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour')]);

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: 'flour',
          parsed: parsedIngredient,
          canonId: 'canon-flour',
          matchState: 'matched',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    const result = await canonicaliseIngredients(recipe);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(fs.callCanonicaliseRecipeIngredients).not.toHaveBeenCalled();
    expect(fs.saveRecipe).not.toHaveBeenCalled();
  });

  it('re-canonicalises a matched ingredient whose canon item was deleted (dangling)', async () => {
    // canon store is empty — 'canon-flour' no longer exists.
    mockGetCanonItemsSnapshot.mockReturnValue([]);

    const canon = makeCanonItem('canon-flour-new');
    fs.callCanonicaliseRecipeIngredients.mockResolvedValue({
      kind: 'ok',
      value: [{ kind: 'ok', value: { decision: 'matched', item: canon } }],
    });

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: 'flour',
          parsed: parsedIngredient,
          canonId: 'canon-flour',
          matchState: 'matched',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    await canonicaliseIngredients(recipe);

    expect(fs.callCanonicaliseRecipeIngredients).toHaveBeenCalledOnce();
    const saved = (fs.saveRecipe as ReturnType<typeof vi.fn>).mock.calls[0][0] as Recipe;
    expect(saved.ingredients[0].items[0].canonId).toBe('canon-flour-new');
    expect(saved.ingredients[0].items[0].matchState).toBe('matched');
  });

  it('calls the batch CF with rawName from parsed.item and rawText from ingredient', async () => {
    const canon = makeCanonItem('canon-butter', false);
    fs.callCanonicaliseRecipeIngredients.mockResolvedValue({
      kind: 'ok',
      value: [{ kind: 'ok', value: { decision: 'matched', item: canon } }],
    });

    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: '100g unsalted butter, melted',
          parsed: { ...parsedIngredient, item: 'butter' },
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);

    await canonicaliseIngredients(recipe);

    expect(fs.callCanonicaliseRecipeIngredients).toHaveBeenCalledWith({
      items: [{ rawName: 'butter', rawText: '100g unsalted butter, melted' }],
    });
  });

  it('handles multiple ingredients across groups in a single batch call', async () => {
    const canonFlour = makeCanonItem('canon-flour', false);
    const canonSugar = makeCanonItem('canon-sugar', false);
    fs.callCanonicaliseRecipeIngredients.mockResolvedValue({
      kind: 'ok',
      value: [
        { kind: 'ok', value: { decision: 'matched', item: canonFlour } },
        { kind: 'ok', value: { decision: 'matched', item: canonSugar } },
      ],
    });

    const recipe = makeRecipe([
      {
        id: 'g1',
        name: 'Dry',
        items: [
          {
            id: 'i1',
            rawText: '2 cups flour',
            parsed: { ...parsedIngredient, item: 'flour' },
            canonId: null,
            matchState: 'pending',
            isOptional: false,
            firstUsedInStepId: null,
          },
        ],
      },
      {
        id: 'g2',
        name: 'Wet',
        items: [
          {
            id: 'i2',
            rawText: '1 cup sugar',
            parsed: { ...parsedIngredient, item: 'sugar' },
            canonId: null,
            matchState: 'pending',
            isOptional: false,
            firstUsedInStepId: null,
          },
        ],
      },
    ]);

    await canonicaliseIngredients(recipe);

    expect(fs.callCanonicaliseRecipeIngredients).toHaveBeenCalledOnce();
    const saved = (fs.saveRecipe as ReturnType<typeof vi.fn>).mock.calls[0][0] as Recipe;
    expect(saved.ingredients[0].items[0].canonId).toBe('canon-flour');
    expect(saved.ingredients[1].items[0].canonId).toBe('canon-sugar');
  });
});
