import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import type { Recipe, CanonItem, IngredientGroup, ProductForm } from '@salt/domain';

// The first render coverage for the recipe-add review sheet. A product-form row is
// labelled with the PARENT product ("Lime (3 count)") — deliberately far from the
// recipe's own wording — and a collapsed row mentions neither of the lines that
// justified its count. This pins that the original wording is rendered ALONGSIDE
// the label (issue #528), and that ordinary rows are untouched.

const { mockCanonItems, mockGetCanonItemsSnapshot, mockGetProductFormsSnapshot } = vi.hoisted(
  () => {
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
      mockCanonItems: makeStore<CanonItem[]>([]),
      mockGetCanonItemsSnapshot: vi.fn(() => [] as CanonItem[]),
      mockGetProductFormsSnapshot: vi.fn(() => [] as ProductForm[]),
    };
  },
);

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
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  getCanonItemsSnapshot: mockGetCanonItemsSnapshot,
}));
vi.mock('../src/lib/productFormService.js', () => ({
  getProductFormsSnapshot: mockGetProductFormsSnapshot,
}));

import RecipeAddToListSheet from '../src/routes/recipes/RecipeAddToListSheet.svelte';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCanonItem(id: string, name: string): CanonItem {
  return {
    id,
    schemaVersion: 5,
    name,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
  };
}

function ingredient(id: string, canonId: string, item: string, amount: number, unit: 'ml' | 'g') {
  return {
    id,
    rawText: `${amount} ${unit} ${item}`,
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

function renderSheet(recipe: Recipe) {
  return render(RecipeAddToListSheet, { props: { recipe, listId: 'list-1', open: true } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCanonItemsSnapshot.mockReturnValue([]);
  mockGetProductFormsSnapshot.mockReturnValue([]);
});
afterEach(() => cleanup());

describe('RecipeAddToListSheet — original recipe wording', () => {
  it('shows the recipe wording beneath the parent-product label', async () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-lime', 'lime')]);
    mockGetProductFormsSnapshot.mockReturnValue([
      {
        id: 'form-juice',
        schemaVersion: 1,
        matchers: ['lime juice'],
        parentCanonId: 'canon-lime',
        label: 'lime juice',
        yield: { formUnit: 'ml', amountPerParent: 30 },
        updatedAt: '',
      },
    ]);

    renderSheet(makeRecipe([ingredient('i1', 'canon-lime', 'lime juice', 60, 'ml')]));

    // The parent label survives — the wording rides ALONGSIDE it, never instead.
    const row = await screen.findByTestId('recipe-add-review-row');
    expect(row.textContent).toContain('Lime');
    expect(row.textContent).toContain('2 count');
    const lines = screen.getAllByTestId('recipe-add-review-original-text');
    expect(lines.map((el) => el.textContent)).toEqual(['60 ml lime juice']);
  });

  it('lists both lines under a single collapsed row', async () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-lime', 'lime')]);
    mockGetProductFormsSnapshot.mockReturnValue([
      {
        id: 'form-juice',
        schemaVersion: 1,
        matchers: ['lime juice'],
        parentCanonId: 'canon-lime',
        label: 'lime juice',
        yield: { formUnit: 'ml', amountPerParent: 30 },
        updatedAt: '',
      },
      {
        id: 'form-zest',
        schemaVersion: 1,
        matchers: ['lime zest'],
        parentCanonId: 'canon-lime',
        label: 'lime zest',
        yield: { formUnit: 'g', amountPerParent: 5 },
        updatedAt: '',
      },
    ]);

    renderSheet(
      makeRecipe([
        ingredient('i1', 'canon-lime', 'lime juice', 60, 'ml'),
        ingredient('i2', 'canon-lime', 'lime zest', 15, 'g'),
      ]),
    );

    // One row, both lines — winner (zest, 3 limes) first.
    await waitFor(() => expect(screen.getAllByTestId('recipe-add-review-row')).toHaveLength(1));
    const lines = screen.getAllByTestId('recipe-add-review-original-text');
    expect(lines.map((el) => el.textContent)).toEqual(['15 g lime zest', '60 ml lime juice']);
  });

  it('renders ordinary rows exactly as before — no wording line', async () => {
    mockGetCanonItemsSnapshot.mockReturnValue([makeCanonItem('canon-salt', 'salt')]);

    renderSheet(makeRecipe([ingredient('i1', 'canon-salt', 'salt', 5, 'g')]));

    await waitFor(() => expect(screen.getAllByTestId('recipe-add-review-row')).toHaveLength(1));
    expect(screen.queryAllByTestId('recipe-add-review-original-text')).toHaveLength(0);
  });
});
