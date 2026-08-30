/**
 * Add-field combobox filtering — the behaviour #939 Phase 2 must preserve.
 *
 * `ShoppingListPage`'s `filterFn` matches a candidate on a case-insensitive
 * substring of its title-cased label OR of any of its canon synonyms. Phase 2
 * hoists the synonym lookup out of the per-candidate scan into a `$derived`
 * Map; these cases are written and seen green against the UNMODIFIED page, so
 * that if the hoist changes what matches, this file reddens.
 *
 * `CanonCreatePage.test.ts`'s `combobox filtering` block is the same contract on
 * the other page; this is its missing counterpart.
 *
 * Two things this file deliberately does not pin:
 *  - **Ordering.** That is `ShoppingListPage.addFieldOrder.test.ts`'s subject
 *    (#726). Purchase counts are seeded empty here and assertions compare sorted
 *    labels, so a ranking change cannot redden a filtering test.
 *  - **A candidate whose canon item is absent from the store.** The contract says
 *    such a candidate falls back to its label alone, and that is true of both the
 *    old `.find` and the new `Map.get` — but it is unreachable from the public
 *    surface: `comboItems` is derived from `$canonItems`, so every candidate's
 *    canon is present by construction. There is no input that drives it.
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
} = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
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

// Local fixture, as in all twelve sibling files. `@salt/domain` exports builders
// for recipes only (UT-C2), and hoisting this one to `tests/support/` (UT-C4)
// would edit those twelve — outside this phase's scope.
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

const CANON: CanonItem[] = [
  canonItem({ id: 'c-oo', name: 'olive oil', synonyms: ['EVOO', 'extra virgin'] }),
  canonItem({ id: 'c-garlic', name: 'garlic' }),
];

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
  mockCanonItems._set(CANON);
  // Every count zero, so ranking cannot vary between cases (#726).
  mockPurchaseCounts._set({});
});

/**
 * The suggestion labels currently offered, sorted. `ComboboxCreate` renders as a
 * `role="option"` too and is always last; it is the custom-entry affordance, not
 * a suggestion, so it is dropped here.
 */
async function suggestionsFor(query: string): Promise<string[]> {
  const user = userEvent.setup();
  const { findByTestId } = render(ShoppingListPage, { props: { params: { listId: 'list-1' } } });
  const input = await findByTestId('shopping-item-input');
  await user.click(input);
  if (query) await user.type(input, query);
  return [...document.querySelectorAll('[role="option"]')]
    .map((el) => (el.textContent ?? '').trim())
    .filter((label) => !label.startsWith('Create "'))
    .sort();
}

describe('ShoppingListPage — combobox filtering', () => {
  it.each([
    {
      matches: 'a case-insensitive substring of the title-cased label',
      query: 'OLIVE',
      expected: ['Olive Oil'],
    },
    {
      matches: 'a case-insensitive substring of a synonym',
      query: 'evoo',
      expected: ['Olive Oil'],
    },
    { matches: 'neither the label nor any synonym', query: 'quinoa', expected: [] },
  ])('offers $expected when the query is $query — $matches', async ({ query, expected }) => {
    expect(await suggestionsFor(query)).toEqual(expected);
  });

  it('offers every item once the query is cleared back to empty', async () => {
    const user = userEvent.setup();
    const { findByTestId } = render(ShoppingListPage, { props: { params: { listId: 'list-1' } } });
    const input = await findByTestId('shopping-item-input');

    // The popup opens only once you type (`openOnClick={false}`, ui-spec-v04 §3),
    // so empty input is reached by clearing rather than by clicking.
    await user.click(input);
    await user.type(input, 'olive');
    await user.clear(input);

    const labels = [...document.querySelectorAll('[role="option"]')]
      .map((el) => (el.textContent ?? '').trim())
      .filter((label) => !label.startsWith('Create "'))
      .sort();
    expect(labels).toEqual(['Garlic', 'Olive Oil']);
  });
});
