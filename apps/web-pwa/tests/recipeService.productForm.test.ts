import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Recipe,
  CanonItem,
  IngredientGroup,
  ProductForm,
  ShoppingBehavior,
} from '@salt/domain';

// The product-form add path (issues #500/#518/#521). buildRecipeAddPlan collapses
// a parent's form rows to ONE row per recipe, and the correctness of the shopping
// count depends entirely on the losers' demand riding onto the survivor as
// `formDemand` — drop it and the display layer can never recover the per-form sum.
// The pure aggregation is covered in @salt/domain; this pins the ADD-TIME
// plumbing that feeds it, which was previously untested.

// ─── Mock firebase-sync ──────────────────────────────────────────────────────
vi.mock('@salt/firebase-sync', () => ({
  subscribeRecipes: vi.fn(() => vi.fn()),
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callParseRecipeIngredients: vi.fn(),
  callCanonicaliseRecipeIngredients: vi.fn(),
  saveShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  isAuthTransitioning: vi.fn(() => false),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  startUserActionSpan: vi.fn(() => ({ traceparent: undefined, end: vi.fn() })),
}));

const { mockGetCanonItemsSnapshot } = vi.hoisted(() => ({
  mockGetCanonItemsSnapshot: vi.fn(() => [] as CanonItem[]),
}));
vi.mock('../src/lib/canonService.js', () => ({
  getCanonItemsSnapshot: mockGetCanonItemsSnapshot,
}));

const { mockGetProductFormsSnapshot } = vi.hoisted(() => ({
  mockGetProductFormsSnapshot: vi.fn(() => [] as ProductForm[]),
}));
vi.mock('../src/lib/productFormService.js', () => ({
  getProductFormsSnapshot: mockGetProductFormsSnapshot,
}));

import { buildRecipeAddPlan } from '../src/lib/recipeService.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCanonItem(
  id: string,
  shoppingBehavior: ShoppingBehavior = 'needed',
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

function makeForm(
  id: string,
  matcher: string,
  parentCanonId: string,
  formUnit: 'ml' | 'g' | 'count',
  amountPerParent: number,
): ProductForm {
  return {
    id,
    schemaVersion: 1,
    matchers: [matcher],
    parentCanonId,
    label: matcher,
    yield: { formUnit, amountPerParent },
    updatedAt: '',
  };
}

function formIngredient(
  id: string,
  canonId: string,
  item: string,
  amount: number,
  unit: 'ml' | 'g' | null,
) {
  return {
    id,
    rawText: `${amount} ${unit ?? ''} ${item}`.trim(),
    parsed: {
      quantity: { type: 'single' as const, value: amount },
      unit,
      item,
      preparation: [],
      notes: null,
      displayText: null,
    } as never,
    canonId,
    matchState: 'matched' as const,
    isOptional: false,
    firstUsedInStepId: null,
  };
}

function makeRecipe(items: IngredientGroup['items']): Recipe {
  return {
    id: 'recipe-1',
    schemaVersion: 1,
    title: 'Test Recipe',
    description: null,
    ingredients: [{ id: 'g1', name: null, items }],
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCanonItemsSnapshot.mockReturnValue([]);
  mockGetProductFormsSnapshot.mockReturnValue([]);
});

// ─── The SAME form on two lines SUMS (issue #521's beef-stock case) ──────────

describe('buildRecipeAddPlan — same form on two lines', () => {
  beforeEach(() => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-cube')]);
    mockGetProductFormsSnapshot.mockReturnValue([
      makeForm('form-stock', 'beef stock', 'canon-cube', 'ml', 500),
    ]);
  });

  it('carries BOTH lines demand onto the one surviving row', () => {
    // Braise 400 ml + gravy 400 ml against a 500 ml cube.
    const rows = buildRecipeAddPlan(
      makeRecipe([
        formIngredient('i1', 'canon-cube', 'beef stock', 400, 'ml'),
        formIngredient('i2', 'canon-cube', 'beef stock', 400, 'ml'),
      ]),
      2, // base servings — scale 1
    );

    expect(rows).toHaveLength(1);
    // Both demands survive the collapse, sharing a formId so they SUM downstream.
    expect(rows[0]!.formDemand).toEqual([
      { formId: 'form-stock', parentCount: 0.8 },
      { formId: 'form-stock', parentCount: 0.8 },
    ]);
  });

  it('shows the recipe true count (2 cubes), not the winning row own count (1)', () => {
    const rows = buildRecipeAddPlan(
      makeRecipe([
        formIngredient('i1', 'canon-cube', 'beef stock', 400, 'ml'),
        formIngredient('i2', 'canon-cube', 'beef stock', 400, 'ml'),
      ]),
      2,
    );
    expect(rows[0]!.amount).toBe(2);
    expect(rows[0]!.unit).toBe('count');
  });

  it('rounds ONCE on the sum: 200 ml + 200 ml of a 500 ml cube is 1, not 2', () => {
    const rows = buildRecipeAddPlan(
      makeRecipe([
        formIngredient('i1', 'canon-cube', 'beef stock', 200, 'ml'),
        formIngredient('i2', 'canon-cube', 'beef stock', 200, 'ml'),
      ]),
      2,
    );
    expect(rows[0]!.amount).toBe(1);
  });
});

// ─── DISTINCT forms of one parent still MAX (issue #500, unchanged) ──────────

describe('buildRecipeAddPlan — distinct forms of one parent', () => {
  beforeEach(() => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-lime')]);
    mockGetProductFormsSnapshot.mockReturnValue([
      makeForm('form-juice', 'lime juice', 'canon-lime', 'ml', 30),
      makeForm('form-zest', 'lime zest', 'canon-lime', 'g', 5),
    ]);
  });

  it('collapses to one row at the MAX, carrying every form demand', () => {
    // 60 ml juice = 2 limes; 15 g zest = 3 limes. One lime gives both → 3.
    const rows = buildRecipeAddPlan(
      makeRecipe([
        formIngredient('i1', 'canon-lime', 'lime juice', 60, 'ml'),
        formIngredient('i2', 'canon-lime', 'lime zest', 15, 'g'),
      ]),
      2,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(3);
    // The LOSING row's demand (juice) rides along — dropping it would make the
    // cross-recipe sum unrecoverable at display time.
    expect(rows[0]!.formDemand).toEqual([
      { formId: 'form-juice', parentCount: 2 },
      { formId: 'form-zest', parentCount: 3 },
    ]);
  });
});

// ─── The corrected count drives the stocked threshold ────────────────────────

describe('buildRecipeAddPlan — stocked parent threshold', () => {
  it('re-decides Add against the summed count, not the under-stated row count', () => {
    // Stocked cubes, threshold 1: one 400 ml line alone (1 cube) stays off the
    // list, but two lines are 2 cubes — over the threshold, so buy them.
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-cube', 'stocked', 1)]);
    mockGetProductFormsSnapshot.mockReturnValue([
      makeForm('form-stock', 'beef stock', 'canon-cube', 'ml', 500),
    ]);

    const one = buildRecipeAddPlan(
      makeRecipe([formIngredient('i1', 'canon-cube', 'beef stock', 400, 'ml')]),
      2,
    );
    expect(one[0]!.amount).toBe(1);
    expect(one[0]!.add).toBe(false);

    const two = buildRecipeAddPlan(
      makeRecipe([
        formIngredient('i1', 'canon-cube', 'beef stock', 400, 'ml'),
        formIngredient('i2', 'canon-cube', 'beef stock', 400, 'ml'),
      ]),
      2,
    );
    expect(two[0]!.amount).toBe(2);
    expect(two[0]!.add).toBe(true);
  });
});

// ─── Ordinary rows are untouched ─────────────────────────────────────────────

describe('buildRecipeAddPlan — non-form rows', () => {
  it('leaves same-canon rows alone and sets no formDemand', () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-flour')]);
    mockGetProductFormsSnapshot.mockReturnValue([
      makeForm('form-stock', 'beef stock', 'canon-cube', 'ml', 500),
    ]);

    const rows = buildRecipeAddPlan(
      makeRecipe([
        formIngredient('i1', 'canon-flour', 'flour', 200, 'g'),
        formIngredient('i2', 'canon-flour', 'flour', 300, 'g'),
      ]),
      2,
    );

    // Combining ordinary same-canon rows stays a display concern — no collapse.
    expect(rows).toHaveLength(2);
    expect(rows[0]!.formDemand).toBeUndefined();
    expect(rows[1]!.formDemand).toBeUndefined();
  });
});
