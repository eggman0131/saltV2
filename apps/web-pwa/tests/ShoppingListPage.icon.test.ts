import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
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

const ICON_URL = 'https://storage.googleapis.com/bucket/canon-icons/milk.webp';

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
  mockAisles._set([]);
  mockCanonItems._set([]);
  mockItems._set([]);
});

describe('ShoppingListPage — canon icons', () => {
  it('renders a canon icon image for a matched item with a thumbnail', async () => {
    mockCanonItems._set([canonItem({ id: 'c-milk', name: 'milk', thumbnail: ICON_URL })]);
    mockItems._set([item({ id: 'i1', rawText: 'milk', canonId: 'c-milk', matchState: 'matched' })]);

    const { findByTestId } = render(ShoppingListPage, { props: { params: { listId: 'list-1' } } });

    const img = (await findByTestId('canon-icon-img')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(ICON_URL);
  });

  it('renders a bare tile (no image) for an unmatched/pending item', async () => {
    mockItems._set([item({ id: 'i2', rawText: 'mystery', canonId: null, matchState: 'pending' })]);

    const { findAllByTestId, queryByTestId } = render(ShoppingListPage, {
      props: { params: { listId: 'list-1' } },
    });

    expect((await findAllByTestId('canon-icon')).length).toBeGreaterThan(0);
    expect(queryByTestId('canon-icon-img')).toBeNull();
  });

  it('dims the icon for a checked item', async () => {
    mockCanonItems._set([canonItem({ id: 'c-milk', name: 'milk', thumbnail: ICON_URL })]);
    mockItems._set([
      item({ id: 'i3', rawText: 'milk', canonId: 'c-milk', matchState: 'matched', checked: true }),
    ]);

    const { findByTestId } = render(ShoppingListPage, { props: { params: { listId: 'list-1' } } });

    // The checked section starts collapsed — expand it to reveal the row.
    await fireEvent.click(await findByTestId('shopping-checked-toggle'));

    const tile = await findByTestId('canon-icon');
    expect(tile).toHaveClass('opacity-40');
  });
});
