import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { CanonItem, ProductForm, ShoppingList, ShoppingListItem } from '@salt/domain';
import type { ShoppingDayDoc } from '@salt/domain/schemas';

// The shopping list's read-only shop-day line (issue #629): what you are
// stocking for, sitting under the list name, tapping through to the planner week
// where the shop day is actually set. It appears on the DEFAULT list only — the
// other lists are background collectors for specialist stores, shopped whenever,
// and the weekly shop says nothing about them.

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
    mockUpcomingShopDay: makeStore<ShoppingDayDoc | null | undefined>(undefined),
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

// "Today" is pinned to Wednesday 12 Aug 2026, so the shop dates below land on a
// known weekday and a known number of days out.
const TODAY = new Date('2026-08-12T09:00:00.000Z');

function shopDay(date: string, slot: 'am' | 'pm' = 'am'): ShoppingDayDoc {
  return { date, slot, schemaVersion: 1, setBy: 'uid-a', setAt: '2026-08-10T09:00:00.000Z' };
}

const defaultList = { props: { params: { listId: 'list-1' } } };
const otherList = { props: { params: { listId: 'list-2' } } };

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
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
  mockUpcomingShopDay._set(undefined);
});

describe('ShoppingListPage — shop-day line (#629)', () => {
  it('names the weekday and slot of a shop later in the week', async () => {
    mockUpcomingShopDay._set(shopDay('2026-08-15')); // Saturday, 3 days out
    const { findByTestId } = render(ShoppingListPage, defaultList);
    expect(await findByTestId('shopping-shop-day')).toHaveTextContent('Shopping Sat AM');
  });

  it('carries the slot through', async () => {
    mockUpcomingShopDay._set(shopDay('2026-08-15', 'pm'));
    const { findByTestId } = render(ShoppingListPage, defaultList);
    expect(await findByTestId('shopping-shop-day')).toHaveTextContent('Shopping Sat PM');
  });

  it('says "tomorrow" the day before, matching the push copy', async () => {
    mockUpcomingShopDay._set(shopDay('2026-08-13'));
    const { findByTestId } = render(ShoppingListPage, defaultList);
    expect(await findByTestId('shopping-shop-day')).toHaveTextContent('Shopping tomorrow AM');
  });

  it('says "today" on the day itself', async () => {
    mockUpcomingShopDay._set(shopDay('2026-08-12'));
    const { findByTestId } = render(ShoppingListPage, defaultList);
    expect(await findByTestId('shopping-shop-day')).toHaveTextContent('Shopping today AM');
  });

  it('emphasises the day that changes what you do, and only that day', async () => {
    // Today and tomorrow are the two states where the list still being wrong
    // actually costs something; the rest of the week reads as plain context.
    mockUpcomingShopDay._set(shopDay('2026-08-13'));
    const near = render(ShoppingListPage, defaultList);
    const nearCls = (await near.findByTestId('shopping-shop-day')).querySelector('span')?.className;
    expect(nearCls).toContain('text-destructive');
    cleanup();

    mockUpcomingShopDay._set(shopDay('2026-08-15'));
    const far = render(ShoppingListPage, defaultList);
    const farCls = (await far.findByTestId('shopping-shop-day')).querySelector('span')?.className;
    expect(farCls).toContain('text-foreground');
    expect(farCls).not.toContain('text-destructive');
  });

  it('prompts when no shop day is set', async () => {
    // Without this the feature fails silently in exactly the situation it exists
    // for: a week passes unmarked and nothing on either surface says so.
    mockUpcomingShopDay._set(null);
    const { findByTestId } = render(ShoppingListPage, defaultList);
    expect(await findByTestId('shopping-shop-day')).toHaveTextContent('No shop day set');
  });

  it('says nothing until the subscription has resolved', () => {
    // undefined is "not loaded", distinct from null. Without the split the
    // "No shop day set" prompt would flash on every page load.
    mockUpcomingShopDay._set(undefined);
    const { queryByTestId } = render(ShoppingListPage, defaultList);
    expect(queryByTestId('shopping-shop-day')).not.toBeInTheDocument();
  });

  it('says nothing about a shop that has already happened', () => {
    // An app left open across midnight for days keeps a stale lookahead window;
    // a past date must not be announced as upcoming.
    mockUpcomingShopDay._set(shopDay('2026-08-10'));
    const { queryByTestId } = render(ShoppingListPage, defaultList);
    expect(queryByTestId('shopping-shop-day')).not.toBeInTheDocument();
  });

  it('is absent on a non-default list', () => {
    mockUpcomingShopDay._set(shopDay('2026-08-15'));
    const { queryByTestId } = render(ShoppingListPage, otherList);
    expect(queryByTestId('shopping-shop-day')).not.toBeInTheDocument();
  });

  it('opens that week in the planner when tapped', async () => {
    mockUpcomingShopDay._set(shopDay('2026-08-15'));
    const { findByTestId } = render(ShoppingListPage, defaultList);
    await fireEvent.click(await findByTestId('shopping-shop-day'));
    expect(mockPush).toHaveBeenCalledWith('/mealplan/2026-08-15');
  });

  it('opens the planner with no week named when nothing is set', async () => {
    mockUpcomingShopDay._set(null);
    const { findByTestId } = render(ShoppingListPage, defaultList);
    await fireEvent.click(await findByTestId('shopping-shop-day'));
    expect(mockPush).toHaveBeenCalledWith('/mealplan');
  });
});
