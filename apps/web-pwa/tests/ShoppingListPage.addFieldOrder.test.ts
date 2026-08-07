/**
 * Add-field ordering — most-bought first (issue #726).
 *
 * The point of counting tick-offs is this list. Type "on" and Onion, bought a
 * dozen times, must come above Onion Powder, bought once. Before this the order
 * was whatever the canon collection happened to hand over.
 *
 * The fallback matters as much as the ranking: on day one every count is zero
 * and at ~5 users it will be weeks before the signal earns its place, so an
 * unranked field must be ALPHABETICAL rather than arbitrary.
 *
 * Everything else about the field is unchanged and stays pinned here — the
 * popup still opens only once you type (`openOnClick={false}`, ui-spec-v04 §3),
 * and custom entries still work.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { CanonItem, ShoppingList, ShoppingListItem } from '@salt/domain';

const {
  mockCanonItems,
  mockAisles,
  mockPurchaseCounts,
  mockLists,
  mockItems,
  mockDefaultListId,
  mockLoading,
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
    mockPurchaseCounts: makeStore<Record<string, number>>({}),
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
  purchaseCounts: mockPurchaseCounts,
}));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({
  lists: mockLists,
  defaultListId: mockDefaultListId,
  itemsForActiveList: mockItems,
  isLoadingShoppingList: mockLoading,
  setActiveListId: vi.fn(),
  addItemToList: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLists._set([{ id: 'list-1', name: 'Groceries' } as ShoppingList]);
  mockDefaultListId._set('list-1');
  mockLoading._set(false);
  mockAisles._set([]);
  mockItems._set([]);
  mockCanonItems._set([]);
  mockPurchaseCounts._set({});
});

/** The labels of the suggestions currently offered, in the order rendered. */
async function suggestionsFor(query: string): Promise<string[]> {
  const user = userEvent.setup();
  const { findByTestId } = render(ShoppingListPage, { props: { params: { listId: 'list-1' } } });
  const input = await findByTestId('shopping-item-input');
  await user.click(input);
  await user.type(input, query);
  // ComboboxCreate renders as a role="option" too and is always last; it is the
  // "custom entry still works" affordance, not a suggestion, so drop it here.
  return [...document.querySelectorAll('[role="option"]')]
    .map((el) => (el.textContent ?? '').trim())
    .filter((label) => !label.startsWith('Create "'));
}

describe('ShoppingListPage — add-field ordering', () => {
  it('puts the most-bought match first, whatever order canon arrived in', async () => {
    mockCanonItems._set([
      canonItem({ id: 'c-powder', name: 'onion powder' }),
      canonItem({ id: 'c-onion', name: 'onion' }),
    ]);
    mockPurchaseCounts._set({ 'c-onion': 12, 'c-powder': 1 });

    expect(await suggestionsFor('on')).toEqual(['Onion', 'Onion Powder']);
  });

  it('falls back to alphabetical when nothing has been bought yet', async () => {
    mockCanonItems._set([
      canonItem({ id: 'c-onion', name: 'onion' }),
      canonItem({ id: 'c-powder', name: 'onion powder' }),
      canonItem({ id: 'c-bhaji', name: 'onion bhaji' }),
    ]);
    mockPurchaseCounts._set({});

    expect(await suggestionsFor('on')).toEqual(['Onion', 'Onion Bhaji', 'Onion Powder']);
  });

  it('ranks by count first and only breaks ties alphabetically', async () => {
    mockCanonItems._set([
      canonItem({ id: 'c-a', name: 'milk chocolate' }),
      canonItem({ id: 'c-b', name: 'milk, semi-skimmed' }),
      canonItem({ id: 'c-c', name: 'milk, oat' }),
    ]);
    // Two on equal footing behind the leader — the tiebreak decides those two.
    mockPurchaseCounts._set({ 'c-b': 40, 'c-a': 2, 'c-c': 2 });

    expect(await suggestionsFor('milk')).toEqual([
      'Milk, Semi-Skimmed',
      'Milk Chocolate',
      'Milk, Oat',
    ]);
  });

  it('treats an item with no recorded purchases as zero rather than dropping it', async () => {
    mockCanonItems._set([
      canonItem({ id: 'c-onion', name: 'onion' }),
      canonItem({ id: 'c-powder', name: 'onion powder' }),
    ]);
    mockPurchaseCounts._set({ 'c-powder': 3 });

    expect(await suggestionsFor('on')).toEqual(['Onion Powder', 'Onion']);
  });

  it('still opens only once you type — the field is otherwise unchanged', async () => {
    mockCanonItems._set([canonItem({ id: 'c-onion', name: 'onion' })]);
    const user = userEvent.setup();
    const { findByTestId } = render(ShoppingListPage, { props: { params: { listId: 'list-1' } } });

    const input = await findByTestId('shopping-item-input');
    await user.click(input);

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });
});
