/**
 * shopping.item_purchased — the purchase signal (#725).
 *
 * The tile this event replaces ranked the recipe corpus, not the shopping:
 * `canon.match` fires once per ingredient when a recipe is imported, so pantry
 * staples won. Ranking on the tick-off instead means the event must be PER ITEM
 * (unlike `shopping.item_completed`, which is one per gesture), must fire only
 * in the tick direction, and must fire only for an item whose own write landed.
 * These tests pin all three, plus the scrubbing rule: canon names only, never
 * the user's rawText.
 */
import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { CanonItem, ShoppingListItem } from '@salt/domain';

vi.mock('@salt/firebase-sync', () => ({
  subscribeShoppingLists: vi.fn(),
  createShoppingList: vi.fn(),
  renameShoppingList: vi.fn(),
  deleteShoppingList: vi.fn(),
  subscribeShoppingListItems: vi.fn(),
  saveShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteShoppingListItem: vi.fn(),
  deleteShoppingListItems: vi.fn(),
  moveShoppingListItems: vi.fn(),
  subscribeShoppingListsConfig: vi.fn(),
  saveShoppingListsConfig: vi.fn(),
  recordCanonPurchases: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  subscribeMembers: vi.fn(),
  upsertMember: vi.fn(),
  deleteMember: vi.fn(),
  isAuthTransitioning: vi.fn(() => false),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  trackUsageEvent: vi.fn(),
  startUserActionSpan: vi.fn(() => ({
    traceparent: '',
    child: vi.fn(() => ({ setError: vi.fn(), end: vi.fn() })),
    setError: vi.fn(),
    setAttribute: vi.fn(),
    end: vi.fn(),
  })),
}));

// The canon snapshot is the id → name lookup; stand it in directly rather than
// booting the real canon subscription.
const canonItems: CanonItem[] = [];
vi.mock('../src/lib/canonService.js', () => ({
  getCanonItemsSnapshot: () => canonItems,
  // The purchase-count sink rides the same tick-off (#726); it is exercised in
  // shoppingListService.purchaseCounts.test.ts, so here it is only stood up.
  bumpPurchaseCounts: vi.fn(),
}));

vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: null as { uid: string; email: string | null } | null },
}));

import * as firebaseSync from '@salt/firebase-sync';
import { trackUsageEvent } from '@salt/observability';
import {
  checkItems,
  toggleItemChecked,
  uncheckItems,
  setActiveListId,
  __resetShoppingListServiceForTest,
} from '../src/lib/shoppingListService.svelte.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;
const track = vi.mocked(trackUsageEvent);

const NOW = '2026-08-07T00:00:00.000Z';

function item(overrides: Partial<ShoppingListItem> & { id: string }): ShoppingListItem {
  return {
    rawText: 'black pepper, freshly ground',
    notes: '',
    sources: [{ kind: 'manual' }],
    canonId: 'canon-pepper',
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function canon(id: string, name: string): CanonItem {
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
    updatedAt: NOW,
  };
}

// Seed the active-list store the way production does — through the subscription
// callback (mirrors shoppingListService.moveWithEdits.test.ts).
function seedItems(listId: string, items: readonly ShoppingListItem[]): void {
  fs.subscribeShoppingListItems.mockImplementation((_id, onItems) => {
    onItems(items);
    return () => {};
  });
  setActiveListId(listId);
}

function purchasedEvents(): unknown[] {
  return track.mock.calls.filter(([name]) => name === 'shopping.item_purchased').map(([, p]) => p);
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  canonItems.length = 0;
  canonItems.push(canon('canon-pepper', 'Black Pepper'), canon('canon-milk', 'Semi-skimmed milk'));
  __resetShoppingListServiceForTest();
});

describe('toggleItemChecked — single tick-off', () => {
  it('fires one purchase carrying the canon name, never the rawText', async () => {
    seedItems('list-a', [item({ id: 'i1' })]);

    await toggleItemChecked('list-a', item({ id: 'i1' }));

    expect(purchasedEvents()).toEqual([
      { canon_id: 'canon-pepper', canon_name: 'Black Pepper', item_source: 'manual' },
    ]);
    expect(JSON.stringify(purchasedEvents())).not.toContain('black pepper, freshly ground');
  });

  it('reports recipe provenance when any source is a recipe', async () => {
    const withRecipe = item({
      id: 'i1',
      sources: [{ kind: 'manual' }, { kind: 'recipe', recipeId: 'r1', servings: 4 }],
    });
    seedItems('list-a', [withRecipe]);

    await toggleItemChecked('list-a', withRecipe);

    expect(purchasedEvents()).toEqual([
      { canon_id: 'canon-pepper', canon_name: 'Black Pepper', item_source: 'recipe' },
    ]);
  });

  it('still fires for an unresolved item, with null id and name', async () => {
    const unmatched = item({ id: 'i1', canonId: null, matchState: 'failed' });
    seedItems('list-a', [unmatched]);

    await toggleItemChecked('list-a', unmatched);

    expect(purchasedEvents()).toEqual([
      { canon_id: null, canon_name: null, item_source: 'manual' },
    ]);
  });

  it('nulls the name when the canon item is not in the snapshot', async () => {
    const orphan = item({ id: 'i1', canonId: 'canon-gone' });
    seedItems('list-a', [orphan]);

    await toggleItemChecked('list-a', orphan);

    expect(purchasedEvents()).toEqual([
      { canon_id: 'canon-gone', canon_name: null, item_source: 'manual' },
    ]);
  });

  it('does not fire when unticking — that is a correction, not a purchase', async () => {
    const checked = item({ id: 'i1', checked: true });
    seedItems('list-a', [checked]);

    await toggleItemChecked('list-a', checked);

    expect(purchasedEvents()).toEqual([]);
  });

  it('does not fire when the write fails', async () => {
    seedItems('list-a', [item({ id: 'i1' })]);
    fs.saveShoppingListItem.mockResolvedValue({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });

    await toggleItemChecked('list-a', item({ id: 'i1' }));

    expect(purchasedEvents()).toEqual([]);
  });

  it('leaves the one-per-gesture completion event untouched', async () => {
    seedItems('list-a', [item({ id: 'i1' })]);

    await toggleItemChecked('list-a', item({ id: 'i1' }));

    expect(track).toHaveBeenCalledWith('shopping.item_completed', {
      list_id: 'list-a',
      item_count: 1,
    });
  });
});

describe('checkItems — bulk tick-off', () => {
  it('fires one purchase per item, unlike the single gesture event', async () => {
    seedItems('list-a', [
      item({ id: 'i1' }),
      item({ id: 'i2', canonId: 'canon-milk', rawText: 'milk' }),
    ]);

    await checkItems('list-a', ['i1', 'i2']);

    expect(purchasedEvents()).toEqual([
      { canon_id: 'canon-pepper', canon_name: 'Black Pepper', item_source: 'manual' },
      { canon_id: 'canon-milk', canon_name: 'Semi-skimmed milk', item_source: 'manual' },
    ]);
    // The gesture metric stays one event carrying its size.
    expect(track).toHaveBeenCalledWith('shopping.item_completed', {
      list_id: 'list-a',
      item_count: 2,
    });
  });

  it('fires only for the items whose own write landed', async () => {
    seedItems('list-a', [
      item({ id: 'i1' }),
      item({ id: 'i2', canonId: 'canon-milk', rawText: 'milk' }),
    ]);
    fs.saveShoppingListItem.mockImplementation(async (_listId, saved) =>
      saved.id === 'i1'
        ? { kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }
        : { kind: 'ok', value: undefined },
    );

    await checkItems('list-a', ['i1', 'i2']);

    expect(purchasedEvents()).toEqual([
      { canon_id: 'canon-milk', canon_name: 'Semi-skimmed milk', item_source: 'manual' },
    ]);
  });

  it('fires nothing on the unchecking path', async () => {
    seedItems('list-a', [item({ id: 'i1', checked: true })]);

    await uncheckItems('list-a', ['i1']);

    expect(purchasedEvents()).toEqual([]);
  });
});
