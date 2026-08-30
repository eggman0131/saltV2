import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/svelte';
import { emptyRecipe } from '@salt/domain';
import type { CanonItem, ProductForm, Recipe, ShoppingList, ShoppingListItem } from '@salt/domain';

// A recipe's name on the shopping list opens the recipe (#860). Two surfaces
// gain the affordance and nothing else does: the sort-by-recipe section heading
// and the edit sheet's Sources block. These tests pin both, and pin the three
// things that must stay inert — the servings beside the name, a manual item's
// "Added by …", and any name whose recipe has since been deleted (the label is
// a snapshot, so a shopping list routinely outlives the dish).

// ─── Mock stores (hoisted so vi.mock factories can reference them) ─────────────

const {
  mockCanonItems,
  mockAisles,
  mockLists,
  mockItems,
  mockDefaultListId,
  mockLoading,
  mockForms,
  mockRecipes,
} = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockCanonItems: makeStore<CanonItem[]>([]),
    mockAisles: makeStore<{ id: string; name: string; order: number }[]>([]),
    mockLists: makeStore<ShoppingList[]>([]),
    mockItems: makeStore<ShoppingListItem[]>([]),
    mockDefaultListId: makeStore<string | null>('list-1'),
    mockLoading: makeStore<boolean>(false),
    mockForms: makeStore<ProductForm[]>([]),
    mockRecipes: makeStore<readonly Recipe[]>([]),
  };
});

const push = vi.fn();
vi.mock('svelte-spa-router', () => ({ push: (path: string) => push(path) }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  aisles: mockAisles,
  purchaseCounts: {
    subscribe(fn: (v: Record<string, number>) => void) {
      fn({});
      return () => {};
    },
  },
}));
vi.mock('../src/lib/productFormService.js', () => ({
  productForms: mockForms,
}));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
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
    aisleId: 'a-produce',
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

// Only the id is ever read (`liveRecipeIds`), but the fixture is a real Recipe
// all the same: a stub cast past the compiler is how a fixture drifts out of
// shape unnoticed (#942).
const recipeStub = (id: string, title: string): Recipe => ({
  ...emptyRecipe(id, '2026-01-01T00:00:00.000Z'),
  title,
});

const fromRecipe = (label: string, recipeId = 'r1', servings = 4) => [
  { kind: 'recipe' as const, recipeId, servings, label },
];

const props = { props: { params: { listId: 'list-1' } } };

/** Flip the list to "sort by recipe" through the overflow menu, as a user does. */
async function sortByRecipe(findByTestId: (id: string) => Promise<HTMLElement>): Promise<void> {
  await fireEvent.click(await findByTestId('shopping-overflow-btn'));
  await fireEvent.click(await findByTestId('shopping-sort-recipe'));
}

/** Open a row's edit sheet, where the Sources block lives. */
async function openEditSheet(findByTestId: (id: string) => Promise<HTMLElement>): Promise<void> {
  await fireEvent.click(await findByTestId('shopping-item-edit-btn'));
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
  mockAisles._set([{ id: 'a-produce', name: 'Produce', order: 1 }]);
  mockCanonItems._set([canonItem({ id: 'c-onion', name: 'onion' })]);
  mockForms._set([]);
  mockItems._set([]);
  mockRecipes._set([recipeStub('r1', 'Bolognese')]);
});

describe('ShoppingListPage — the sort-by-recipe heading opens the recipe', () => {
  it('navigates to the recipe when the heading is tapped', async () => {
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: fromRecipe('Bolognese') }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);
    await sortByRecipe(findByTestId);

    const link = await findByTestId('shopping-recipe-group-link');
    expect(link.textContent!.trim()).toBe('Bolognese');
    await fireEvent.click(link);

    expect(push).toHaveBeenCalledWith('/recipes/r1');
  });

  it('renders the heading as plain text once the recipe is gone', async () => {
    mockRecipes._set([]);
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: fromRecipe('Bolognese') }),
    ]);

    const { findByTestId, queryByTestId } = render(ShoppingListPage, props);
    await sortByRecipe(findByTestId);

    const section = await findByTestId('shopping-recipe-group');
    expect(section.textContent).toContain('Bolognese');
    expect(queryByTestId('shopping-recipe-group-link')).toBeNull();
    expect(within(section).queryByRole('button', { name: 'Bolognese' })).toBeNull();
  });
});

describe("ShoppingListPage — the edit sheet's Sources block", () => {
  it('opens the recipe from its name, and leaves the servings inert', async () => {
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: fromRecipe('Bolognese') }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);
    await openEditSheet(findByTestId);

    const sources = await findByTestId('shopping-edit-sources');
    // The servings read as before, just no longer welded to the name.
    expect(sources.textContent!.replace(/\s+/g, ' ')).toContain('Bolognese (4 servings)');

    const link = await findByTestId('shopping-edit-source-link');
    expect(link.textContent!.trim()).toBe('Bolognese');
    // The servings are not inside the tap target.
    expect(link.textContent).not.toContain('serving');
    // …and they are not a target of their own: the name is the only button here.
    expect(within(sources).getAllByRole('button')).toHaveLength(1);

    await fireEvent.click(link);
    expect(push).toHaveBeenCalledWith('/recipes/r1');
  });

  it('leaves a manually added source as plain text', async () => {
    mockItems._set([
      item({
        id: 'i1',
        rawText: 'onion',
        canonId: 'c-onion',
        sources: [{ kind: 'manual', addedBy: 'Daniel' }],
      }),
    ]);

    const { findByTestId, queryByTestId } = render(ShoppingListPage, props);
    await openEditSheet(findByTestId);

    const sources = await findByTestId('shopping-edit-sources');
    expect(sources.textContent).toContain('Added by Daniel');
    expect(queryByTestId('shopping-edit-source-link')).toBeNull();
    expect(within(sources).queryAllByRole('button')).toHaveLength(0);
  });

  it('renders the name as plain text once the recipe is gone', async () => {
    mockRecipes._set([]);
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: fromRecipe('Bolognese') }),
    ]);

    const { findByTestId, queryByTestId } = render(ShoppingListPage, props);
    await openEditSheet(findByTestId);

    const sources = await findByTestId('shopping-edit-sources');
    expect(sources.textContent!.replace(/\s+/g, ' ')).toContain('Bolognese (4 servings)');
    expect(queryByTestId('shopping-edit-source-link')).toBeNull();
    expect(within(sources).queryAllByRole('button')).toHaveLength(0);
  });
});

// Issue #933 characterisation net. `ShoppingItemRow.svelte`'s `sourceLabel` and
// `ShoppingListPage.svelte`'s `describeSource` both render the same `SourceRef`,
// and they DISAGREE on a `manual` source with no `addedBy`: `sourceLabel`
// returns `''`, which the row's `{#if showSource && sourceLabel(item)}` guard
// turns into no sub-line at all; `describeSource` returns `'Added manually'`,
// which the edit sheet shows. A later phase makes the row say "Added manually"
// too — at that point these two pinned answers are EXPECTED to converge, and
// this test's "no sub-line" half should be the one that changes, not the
// sheet's. The other two shapes (`manual` WITH `addedBy`, and a `recipe`
// source) already agree and must stay that way.
describe('ShoppingListPage — the row and the sheet describe a source the same way (#933)', () => {
  it('EXCEPTION 3: the ROW now says "Added manually" for a manual source with no addedBy', async () => {
    // The flip. This row rendered NOTHING before Phase 7 — `sourceLabel`
    // returned `''` and the template's `{#if showSource && sourceLabel(item)}`
    // guard swallowed it — so an item added by hand by someone signed out was
    // indistinguishable in the list from an item with no source at all, while
    // the edit sheet said exactly what it was.
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: [{ kind: 'manual' }] }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);

    const row = await findByTestId('shopping-item-row');
    expect(row.textContent).toContain('Added manually');
  });

  it('EXCEPTION 3: the EDIT SHEET says the same thing it always did', async () => {
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: [{ kind: 'manual' }] }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);
    await openEditSheet(findByTestId);

    const sources = await findByTestId('shopping-edit-sources');
    expect(sources.textContent).toContain('Added manually');
  });

  it('EXCEPTION 3: and the two now agree, which is the whole point of the phase', async () => {
    // The convergence stated as one assertion rather than inferred from the two
    // above passing separately.
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: [{ kind: 'manual' }] }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);
    const row = await findByTestId('shopping-item-row');
    const rowSaid = row.textContent ?? '';

    await openEditSheet(findByTestId);
    const sources = await findByTestId('shopping-edit-sources');

    expect(rowSaid).toContain('Added manually');
    expect(sources.textContent).toContain('Added manually');
  });

  it('must not change: both surfaces already agree once addedBy is set', async () => {
    mockItems._set([
      item({
        id: 'i1',
        rawText: 'onion',
        canonId: 'c-onion',
        sources: [{ kind: 'manual', addedBy: 'Daniel' }],
      }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);
    const row = await findByTestId('shopping-item-row');
    expect(row.textContent).toContain('Added by Daniel');

    await openEditSheet(findByTestId);
    const sources = await findByTestId('shopping-edit-sources');
    expect(sources.textContent).toContain('Added by Daniel');
  });

  it('must not change: a recipe source stays a bare label in the row (the sheet’s label + servings + link is pinned above)', async () => {
    mockItems._set([
      item({ id: 'i1', rawText: 'onion', canonId: 'c-onion', sources: fromRecipe('Bolognese') }),
    ]);

    const { findByTestId } = render(ShoppingListPage, props);
    const row = await findByTestId('shopping-item-row');
    expect(row.textContent).toContain('Bolognese');
    expect(row.textContent).not.toContain('serving');
  });
});
