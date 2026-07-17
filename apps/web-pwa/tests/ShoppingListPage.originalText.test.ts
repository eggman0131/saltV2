import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type { CanonItem, ProductForm, ShoppingList, ShoppingListItem } from '@salt/domain';

// The shopping row for a product form is labelled with the PARENT product
// ("Lime ×3") — deliberately far from the recipe's own wording — so #528 carries
// the recipe's lines onto the item as `originalText` and shows them beneath the
// headline. These tests pin the RENDER: the wording appears AS WELL AS the parent
// name and count (never instead of), and items written before the field render
// exactly as they did before — no gap, no placeholder, no "unknown".

// ─── Mock stores (hoisted so vi.mock factories can reference them) ─────────────

const {
  mockCanonItems,
  mockAisles,
  mockLists,
  mockItems,
  mockDefaultListId,
  mockLoading,
  mockForms,
} = vi.hoisted(() => {
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
    mockAisles: makeStore<{ id: string; name: string; order: number }[]>([]),
    mockLists: makeStore<ShoppingList[]>([]),
    mockItems: makeStore<ShoppingListItem[]>([]),
    mockDefaultListId: makeStore<string | null>('list-1'),
    mockLoading: makeStore<boolean>(false),
    mockForms: makeStore<ProductForm[]>([]),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  aisles: mockAisles,
}));
vi.mock('../src/lib/productFormService.js', () => ({
  productForms: mockForms,
}));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({
  lists: mockLists,
  defaultListId: mockDefaultListId,
  itemsForActiveList: mockItems,
  isLoadingShoppingList: mockLoading,
  setActiveListId: vi.fn(),
  addItemToList: vi.fn(),
  updateItemRawText: vi.fn(),
  updateItemAmountUnit: vi.fn(),
  updateItemNotes: vi.fn(),
  toggleItemChecked: vi.fn(),
  checkItems: vi.fn(),
  uncheckItems: vi.fn(),
  removeItem: vi.fn(),
  removeItems: vi.fn(),
  clearChecked: vi.fn(),
  moveSelectedItems: vi.fn(),
}));

import ShoppingListPage from '../src/routes/shopping/ShoppingListPage.svelte';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function canonItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 5,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    ...overrides,
  };
}

function item(overrides: Partial<ShoppingListItem> & { id: string }): ShoppingListItem {
  return {
    rawText: 'thing',
    notes: '',
    sources: [],
    canonId: null,
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// A product-form row needs `unit: 'count'`, a canonId, an amount, and a form
// whose matcher resolves the rawText back to that same parent canon.
function limeForm(id: string, matcher: string): ProductForm {
  return {
    id,
    schemaVersion: 1,
    matchers: [matcher],
    parentCanonId: 'c-lime',
    label: matcher,
    yield: { formUnit: 'ml', amountPerParent: 30 },
    updatedAt: '',
  };
}

function formItem(id: string, rawText: string, overrides: Partial<ShoppingListItem> = {}) {
  return item({
    id,
    rawText,
    canonId: 'c-lime',
    matchState: 'matched',
    amount: 3,
    unit: 'count',
    sources: [{ kind: 'recipe', recipeId: 'r1', servings: 2, label: 'Ceviche' }],
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLists._set([{ id: 'list-1', name: 'Groceries' } as ShoppingList]);
  mockDefaultListId._set('list-1');
  mockLoading._set(false);
  // Rows only COMBINE inside an aisle group: the canon needs a live aisleId and
  // that aisle must exist, else every item falls into the unsorted "other" bucket
  // as a single row.
  mockAisles._set([{ id: 'a-produce', name: 'Produce', order: 1 }]);
  mockCanonItems._set([canonItem({ id: 'c-lime', name: 'lime', aisleId: 'a-produce' })]);
  mockForms._set([limeForm('pf-juice', 'lime juice'), limeForm('pf-zest', 'lime zest')]);
  mockItems._set([]);
});

const props = { props: { params: { listId: 'list-1' } } };

describe('ShoppingListPage — original recipe wording on a single product-form row', () => {
  it('shows the recipe wording beneath the parent name and count', async () => {
    mockItems._set([formItem('i1', 'lime juice', { originalText: ['juice of 2 limes'] })]);

    const { findByTestId, container } = render(ShoppingListPage, props);

    const line = await findByTestId('shopping-item-original-text');
    expect(line.textContent).toBe('juice of 2 limes');
    // As well as, never instead of: the parent name and count still headline.
    expect(container.textContent).toContain('Lime');
    expect(container.textContent).toContain('×3');
  });

  it('renders one line per contributing recipe line, in order', async () => {
    mockItems._set([
      formItem('i1', 'lime juice', { originalText: ['zest of 1 lime', 'juice of 2 limes'] }),
    ]);

    const { findAllByTestId } = render(ShoppingListPage, props);

    const lines = await findAllByTestId('shopping-item-original-text');
    expect(lines.map((l) => l.textContent)).toEqual(['zest of 1 lime', 'juice of 2 limes']);
  });

  it('does not truncate the wording (a long line wraps rather than clips)', async () => {
    mockItems._set([
      formItem('i1', 'lime juice', {
        originalText: ['juice of 2 limes (about 60 ml), plus extra wedges to serve alongside'],
      }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);

    // Inside a truncating span the line would clip — Phase 1's invariant.
    expect((await findByTestId('shopping-item-original-text')).className).not.toContain('truncate');
  });

  it('falls back to the cleaned name for an item written before the field', async () => {
    // Back-compat: no gap, no placeholder, no "unknown" — exactly today's render.
    mockItems._set([formItem('i1', 'lime juice')]);

    const { queryByTestId, container } = render(ShoppingListPage, props);

    expect(queryByTestId('shopping-item-original-text')).toBeNull();
    expect(container.textContent).toContain('lime juice');
    expect(container.textContent).toContain('×3');
  });

  it('leaves an ordinary non-form row untouched', async () => {
    mockCanonItems._set([canonItem({ id: 'c-milk', name: 'milk', aisleId: 'a-produce' })]);
    mockItems._set([item({ id: 'i1', rawText: 'milk', canonId: 'c-milk', amount: 2, unit: 'l' })]);

    const { queryByTestId, container } = render(ShoppingListPage, props);

    expect(queryByTestId('shopping-item-original-text')).toBeNull();
    expect(container.textContent).toContain('Milk');
  });
});

describe('ShoppingListPage — original recipe wording on a combined product-form row', () => {
  it('lists every contributor’s wording under the combined headline', async () => {
    mockItems._set([
      formItem('i1', 'lime juice', {
        originalText: ['juice of 2 limes'],
        sources: [{ kind: 'recipe', recipeId: 'r1', servings: 2, label: 'Ceviche' }],
      }),
      formItem('i2', 'lime zest', {
        originalText: ['zest of 1 lime'],
        sources: [{ kind: 'recipe', recipeId: 'r2', servings: 2, label: 'Tart' }],
      }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);

    const toggle = await findByTestId('shopping-combined-toggle');
    // Replaces the old cleaned-name wording ("Lime Juice, Zest") — not a third line.
    expect(toggle.textContent).toContain('juice of 2 limes');
    expect(toggle.textContent).toContain('zest of 1 lime');
    expect(toggle.textContent).toContain('Lime');
  });

  it('mixes old and new contributors sensibly, falling back per contributor', async () => {
    mockItems._set([
      formItem('i1', 'lime juice', { originalText: ['juice of 2 limes'] }),
      // Pre-#528 contributor: no originalText → keeps today's title-cased name.
      formItem('i2', 'lime zest'),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);

    const toggle = await findByTestId('shopping-combined-toggle');
    expect(toggle.textContent).toContain('juice of 2 limes');
    expect(toggle.textContent).toContain('Lime Zest');
  });

  it('de-duplicates identical wording across contributors', async () => {
    mockItems._set([
      formItem('i1', 'lime juice', { originalText: ['juice of 2 limes'] }),
      formItem('i2', 'lime juice', { originalText: ['juice of 2 limes'] }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);

    const toggle = await findByTestId('shopping-combined-toggle');
    const occurrences = toggle.textContent!.split('juice of 2 limes').length - 1;
    expect(occurrences).toBe(1);
  });
});
