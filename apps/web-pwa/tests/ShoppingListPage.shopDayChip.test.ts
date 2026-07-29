import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { CanonItem, ProductForm, ShoppingList, ShoppingListItem } from '@salt/domain';
import type { ShoppingDayDoc } from '@salt/domain/schemas';

// The shopping list's read-only shop-day chip (issue #629): it says what you are
// stocking for, and tapping it opens that week in the planner. It appears on the
// DEFAULT list only — the other lists are background collectors for specialist
// stores, shopped whenever, and the weekly shop says nothing about them.

const {
  mockCanonItems,
  mockAisles,
  mockLists,
  mockItems,
  mockDefaultListId,
  mockLoading,
  mockForms,
  mockUpcomingShopDay,
  mockPush,
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
        subs.forEach((f) => f(v));
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
    mockUpcomingShopDay: makeStore<ShoppingDayDoc | null>(null),
    mockPush: vi.fn(),
  };
});

vi.mock('svelte-spa-router', () => ({ push: mockPush }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  aisles: mockAisles,
}));
vi.mock('../src/lib/productFormService.js', () => ({ productForms: mockForms }));
vi.mock('../src/lib/shoppingDayService.js', () => ({ upcomingShopDay: mockUpcomingShopDay }));
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
  confirmItemNeeded: vi.fn(),
  confirmItemsNeeded: vi.fn(),
}));

import ShoppingListPage from '../src/routes/shopping/ShoppingListPage.svelte';

// 2026-08-15 is a Saturday.
const SATURDAY_AM: ShoppingDayDoc = {
  date: '2026-08-15',
  slot: 'am',
  schemaVersion: 1,
  setBy: 'uid-a',
  setAt: '2026-08-10T09:00:00.000Z',
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLists._set([
    { id: 'list-1', name: 'Groceries' } as ShoppingList,
    { id: 'list-2', name: 'Deli run' } as ShoppingList,
  ]);
  mockDefaultListId._set('list-1');
  mockLoading._set(false);
  mockAisles._set([]);
  mockCanonItems._set([]);
  mockForms._set([]);
  mockItems._set([]);
  mockUpcomingShopDay._set(null);
});

const defaultList = { props: { params: { listId: 'list-1' } } };
const otherList = { props: { params: { listId: 'list-2' } } };

describe('ShoppingListPage — shop-day chip (#629)', () => {
  it('names the day and slot of the next shop', async () => {
    mockUpcomingShopDay._set(SATURDAY_AM);
    const { findByTestId } = render(ShoppingListPage, defaultList);
    expect(await findByTestId('shopping-shop-day-chip')).toHaveTextContent('Shopping Sat AM');
  });

  it('is absent when no shop day is set', () => {
    mockUpcomingShopDay._set(null);
    const { queryByTestId } = render(ShoppingListPage, defaultList);
    expect(queryByTestId('shopping-shop-day-chip')).not.toBeInTheDocument();
  });

  it('is absent on a non-default list', () => {
    // Background collectors are shopped whenever; the weekly shop is not theirs.
    mockUpcomingShopDay._set(SATURDAY_AM);
    const { queryByTestId } = render(ShoppingListPage, otherList);
    expect(queryByTestId('shopping-shop-day-chip')).not.toBeInTheDocument();
  });

  it('opens that week in the planner when tapped', async () => {
    mockUpcomingShopDay._set(SATURDAY_AM);
    const { findByTestId } = render(ShoppingListPage, defaultList);
    await fireEvent.click(await findByTestId('shopping-shop-day-chip'));
    expect(mockPush).toHaveBeenCalledWith('/mealplan/2026-08-15');
  });
});
