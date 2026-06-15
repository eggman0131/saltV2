import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { Recipe, CanonItem, IngredientGroup, ShoppingBehavior } from '@salt/domain';

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
import { buildRecipeAddPlan, commitRecipeAddPlan } from '../src/lib/recipeService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCanonItem(
  id: string,
  shoppingBehavior: ShoppingBehavior,
  largeQuantityThreshold?: number,
): CanonItem {
  return {
    id,
    schemaVersion: 5,
    name: id,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior,
    ...(largeQuantityThreshold !== undefined ? { largeQuantityThreshold } : {}),
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

const gramIngredient = {
  quantity: { type: 'single' as const, value: 200 },
  unit: 'g' as const,
  item: 'flour',
  preparation: [],
  notes: null,
  displayText: null,
};

function weightIngredient(grams: number) {
  return {
    quantity: { type: 'single' as const, value: grams },
    unit: 'g' as const,
    item: 'flour',
    preparation: [],
    notes: null,
    displayText: null,
  };
}

// Count/item-based ingredient (e.g. "2 eggs") — no metric unit, so unit is null
// (see recipe schema: unit is null for count/item-based ingredients).
const countIngredient = {
  quantity: { type: 'single' as const, value: 2 },
  unit: null,
  item: 'eggs',
  preparation: [],
  notes: null,
  displayText: null,
};

function matchedIngredient(id: string, canonId: string, parsed: unknown) {
  return {
    id,
    rawText: '2 cups flour',
    parsed: parsed as never,
    canonId,
    matchState: 'matched' as const,
    isOptional: false,
    firstUsedInStepId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  mockGetCanonItemsSnapshot.mockReturnValue([]);
});

// ─── buildRecipeAddPlan ────────────────────────────────────────────────────────

describe('buildRecipeAddPlan', () => {
  it("matched 'needed' ingredient → add on, check off, canon name + scaled amount", () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour', 'needed')]);
    const recipe = makeRecipe([
      makeGroup([matchedIngredient('i1', 'canon-flour', gramIngredient)]),
    ]);

    const rows = buildRecipeAddPlan(recipe, 2); // servings == base, scale 1
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ingredientId: 'i1',
      name: 'canon-flour',
      fromCanon: true,
      matched: true,
      canonId: 'canon-flour',
      amount: 200,
      unit: 'g',
      add: true,
      check: false,
    });
  });

  it("matched 'check' ingredient → add and check on", () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour', 'check')]);
    const recipe = makeRecipe([
      makeGroup([matchedIngredient('i1', 'canon-flour', gramIngredient)]),
    ]);
    const rows = buildRecipeAddPlan(recipe, 2);
    expect(rows[0]).toMatchObject({ add: true, check: true });
  });

  it("matched 'stocked' under threshold → neither; over threshold → add on", () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour', 'stocked', 500)]);

    const under = buildRecipeAddPlan(
      makeRecipe([makeGroup([matchedIngredient('i1', 'canon-flour', weightIngredient(100))])]),
      2,
    );
    expect(under[0]).toMatchObject({ add: false, check: false });

    const over = buildRecipeAddPlan(
      makeRecipe([makeGroup([matchedIngredient('i1', 'canon-flour', weightIngredient(750))])]),
      2,
    );
    expect(over[0]).toMatchObject({ add: true, check: false });
  });

  it('unmatched ingredient → add on, check off, raw-text name, matched false', () => {
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
    const rows = buildRecipeAddPlan(recipe, 2);
    expect(rows[0]).toMatchObject({
      name: 'some unknown thing',
      fromCanon: false,
      matched: false,
      canonId: null,
      add: true,
      check: false,
    });
  });

  it('dangling match (canon deleted) → treated as unmatched', () => {
    mockGetCanonItemsSnapshot.mockReturnValue([]); // canon-flour absent
    const recipe = makeRecipe([
      makeGroup([matchedIngredient('i1', 'canon-flour', countIngredient)]),
    ]);
    const rows = buildRecipeAddPlan(recipe, 2);
    expect(rows[0]).toMatchObject({ matched: false, canonId: null, add: true, check: false });
  });

  it('scales amount by servings', () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour', 'needed')]);
    const recipe = makeRecipe([
      makeGroup([matchedIngredient('i1', 'canon-flour', countIngredient)]),
    ]);
    const rows = buildRecipeAddPlan(recipe, 4); // base 2 → scale 2
    expect(rows[0].amount).toBe(4);
  });
});

// ─── commitRecipeAddPlan ─────────────────────────────────────────────────────

describe('commitRecipeAddPlan', () => {
  it('writes only add=true rows, carrying needsCheck from check', async () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour', 'check')]);
    const recipe = makeRecipe([
      makeGroup([matchedIngredient('i1', 'canon-flour', countIngredient)]),
    ]);
    const rows = buildRecipeAddPlan(recipe, 2); // add+check both true

    const result = await commitRecipeAddPlan(recipe, 'list-1', 2, rows);
    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(fs.saveShoppingListItem).toHaveBeenCalledOnce();
    const saved = (fs.saveShoppingListItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(saved.canonId).toBe('canon-flour');
    expect(saved.matchState).toBe('matched');
    expect(saved.needsCheck).toBe(true);
    expect(saved.rawText).toBe('2 cups flour');
  });

  it('skips rows the user left as add=false', async () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour', 'stocked', 500)]);
    const recipe = makeRecipe([
      makeGroup([matchedIngredient('i1', 'canon-flour', weightIngredient(100))]),
    ]);
    const rows = buildRecipeAddPlan(recipe, 2); // stocked, under threshold → add false

    const result = await commitRecipeAddPlan(recipe, 'list-1', 2, rows);
    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(fs.saveShoppingListItem).not.toHaveBeenCalled();
  });

  it('records the recipe source on written items', async () => {
    const recipe = makeRecipe([
      makeGroup([
        {
          id: 'i1',
          rawText: 'salt',
          parsed: null,
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ]),
    ]);
    const rows = buildRecipeAddPlan(recipe, 3);
    await commitRecipeAddPlan(recipe, 'list-1', 3, rows);
    const saved = (fs.saveShoppingListItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(saved.sources).toEqual([
      { kind: 'recipe', recipeId: 'recipe-1', servings: 3, label: 'Test Recipe' },
    ]);
  });
});
