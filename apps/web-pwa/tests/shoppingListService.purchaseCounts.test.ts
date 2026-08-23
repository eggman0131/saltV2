/**
 * Purchase counts — the tick-off history behind the add field's ordering (#726).
 *
 * Counting the TICK-OFF rather than the add is what makes the signal
 * trustworthy: an add is an intention, a tick is a purchase. So the recorder
 * fires only in the tick direction, only for a row whose own write landed, and
 * only for a row that actually resolved to a canon item.
 *
 * The granularity is the opposite of `shopping.item_purchased` (#725): one call
 * per GESTURE, because 30 per-item writes to a single shared document would hit
 * Firestore's ~1 write/sec sustained per-document limit head-on.
 *
 * And it is a side-effect, never a gate: a failed count write is reported but
 * the shopper's tick-off has already succeeded and must not be disturbed.
 */
import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { ShoppingListItem } from '@salt/domain';

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

const { report, bumpPurchaseCounts } = vi.hoisted(() => ({
  report: vi.fn(),
  bumpPurchaseCounts: vi.fn(),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report })),
  trackUsageEvent: vi.fn(),
  startUserActionSpan: vi.fn(() => ({
    traceparent: '',
    child: vi.fn(() => ({ setError: vi.fn(), end: vi.fn() })),
    setError: vi.fn(),
    setAttribute: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock('../src/lib/canonService.js', () => ({
  getCanonItemsSnapshot: () => [],
  bumpPurchaseCounts,
}));

vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: null as { uid: string; email: string | null } | null },
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  checkItems,
  toggleItemChecked,
  uncheckItems,
  setActiveListId,
  __resetShoppingListServiceForTest,
} from '../src/lib/shoppingListService.svelte.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;
const record = vi.mocked(firebaseSync.recordCanonPurchases);

const NOW = '2026-08-07T00:00:00.000Z';

function item(overrides: Partial<ShoppingListItem> & { id: string }): ShoppingListItem {
  return {
    rawText: 'onions',
    notes: '',
    sources: [{ kind: 'manual' }],
    canonId: 'canon-onion',
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function seedItems(listId: string, items: ShoppingListItem[]): void {
  fs.subscribeShoppingListItems.mockImplementation((_id, onItems) => {
    onItems(items);
    return () => {};
  });
  setActiveListId(listId);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetShoppingListServiceForTest();
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  record.mockResolvedValue({ kind: 'ok', value: undefined });
});

describe('toggleItemChecked', () => {
  it('records the tick-off', async () => {
    const onion = item({ id: 'i1', canonId: 'canon-onion' });
    seedItems('list-1', [onion]);

    await toggleItemChecked('list-1', onion);

    expect(record).toHaveBeenCalledExactlyOnceWith(['canon-onion']);
    expect(bumpPurchaseCounts).toHaveBeenCalledExactlyOnceWith(['canon-onion']);
  });

  it('does not record the untick — a correction, not a return', async () => {
    const onion = item({ id: 'i1', checked: true });
    seedItems('list-1', [onion]);

    await toggleItemChecked('list-1', onion);

    expect(record).not.toHaveBeenCalled();
  });

  it('does not record when the item write failed', async () => {
    fs.saveShoppingListItem.mockResolvedValue({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'corruption' },
    });
    const onion = item({ id: 'i1' });
    seedItems('list-1', [onion]);

    await toggleItemChecked('list-1', onion);

    expect(record).not.toHaveBeenCalled();
  });

  it('skips a row with no canon match — there is no key to count against', async () => {
    const scrawl = item({ id: 'i1', canonId: null, matchState: 'pending' });
    seedItems('list-1', [scrawl]);

    await toggleItemChecked('list-1', scrawl);

    expect(record).not.toHaveBeenCalled();
    expect(bumpPurchaseCounts).not.toHaveBeenCalled();
  });

  it('reports a failed count write but still returns the tick-off as successful', async () => {
    record.mockResolvedValue({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'corruption' },
    });
    const onion = item({ id: 'i1' });
    seedItems('list-1', [onion]);

    const result = await toggleItemChecked('list-1', onion);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    await vi.waitFor(() => expect(report).toHaveBeenCalled());
  });
});

describe('checkItems', () => {
  it('records the whole bulk gesture as ONE call carrying every id', async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      item({ id: `i${i}`, canonId: `canon-${i}` }),
    );
    seedItems('list-1', items);

    await checkItems(
      'list-1',
      items.map((i) => i.id),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toHaveLength(30);
  });

  it('passes a duplicated canon id twice — two rows really were two purchases', async () => {
    const items = [
      item({ id: 'i1', canonId: 'canon-onion' }),
      item({ id: 'i2', canonId: 'canon-onion' }),
    ];
    seedItems('list-1', items);

    await checkItems('list-1', ['i1', 'i2']);

    expect(record).toHaveBeenCalledExactlyOnceWith(['canon-onion', 'canon-onion']);
  });

  it('counts only the rows whose own write landed, and drops unmatched rows', async () => {
    const items = [
      item({ id: 'i1', canonId: 'canon-onion' }),
      item({ id: 'i2', canonId: null, matchState: 'pending' }),
      item({ id: 'i3', canonId: 'canon-milk' }),
    ];
    seedItems('list-1', items);
    fs.saveShoppingListItem
      .mockResolvedValueOnce({ kind: 'ok', value: undefined })
      .mockResolvedValueOnce({ kind: 'ok', value: undefined })
      .mockResolvedValueOnce({
        kind: 'err',
        error: { kind: 'StorageError', reason: 'corruption' },
      });

    await checkItems('list-1', ['i1', 'i2', 'i3']);

    expect(record).toHaveBeenCalledExactlyOnceWith(['canon-onion']);
  });

  it('writes nothing when no ticked row had a canon match', async () => {
    const items = [
      item({ id: 'i1', canonId: null, matchState: 'pending' }),
      item({ id: 'i2', canonId: null, matchState: 'failed' }),
    ];
    seedItems('list-1', items);

    await checkItems('list-1', ['i1', 'i2']);

    expect(record).not.toHaveBeenCalled();
  });
});

describe('uncheckItems', () => {
  it('records nothing — the write path is one-directional', async () => {
    const items = [item({ id: 'i1', checked: true }), item({ id: 'i2', checked: true })];
    seedItems('list-1', items);

    await uncheckItems('list-1', ['i1', 'i2']);

    expect(record).not.toHaveBeenCalled();
  });
});
