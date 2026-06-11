import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, within } from '@testing-library/svelte';
import type { CanonItem, ShoppingList, ShoppingListItem } from '@salt/domain';

// ─── Mock stores (hoisted so vi.mock factories can reference them) ─────────────

const { mockCanonItems, mockAisles, mockLists, mockItems, mockDefaultListId, mockLoading } =
  vi.hoisted(() => {
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
    };
  });

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  aisles: mockAisles,
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
    matchState: 'pending',
    checked: false,
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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
  mockAisles._set([{ id: 'aisle-1', name: 'Produce', order: 0 }]);
  mockCanonItems._set([]);
  mockItems._set([]);
});

describe('ShoppingListPage — dangling canon reference', () => {
  it('routes a matched item with a deleted canon (absent from live store) to the Other section', async () => {
    // Item claims to be matched to a canon that no longer exists in the live store.
    mockCanonItems._set([]);
    mockItems._set([
      item({ id: 'i1', rawText: 'milk', canonId: 'deleted-canon', matchState: 'matched' }),
    ]);

    const { findByTestId, queryByTestId } = render(ShoppingListPage, {
      props: { params: { listId: 'list-1' } },
    });

    const other = await findByTestId('shopping-other');
    expect(within(other).getByText('milk', { exact: false })).toBeTruthy();
    expect(queryByTestId('shopping-aisle-group')).toBeNull();
  });

  it('routes a matched item with a present canon (with aisle) to the aisle group', async () => {
    mockAisles._set([{ id: 'aisle-1', name: 'Produce', order: 0 }]);
    mockCanonItems._set([canonItem({ id: 'c-milk', name: 'milk', aisleId: 'aisle-1' })]);
    mockItems._set([item({ id: 'i1', rawText: 'milk', canonId: 'c-milk', matchState: 'matched' })]);

    const { findByTestId, queryByTestId } = render(ShoppingListPage, {
      props: { params: { listId: 'list-1' } },
    });

    await findByTestId('shopping-aisle-group');
    expect(queryByTestId('shopping-other')).toBeNull();
  });
});
