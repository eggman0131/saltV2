import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUnsubscribe,
  mockOnSnapshot,
  mockSetDoc,
  mockDeleteDoc,
  mockGetDocs,
  mockDoc,
  mockCollection,
  mockGetFirestore,
  mockWriteBatch,
  mockBatchDelete,
  mockBatchSet,
  mockBatchCommit,
} = vi.hoisted(() => {
  const mockBatchDelete = vi.fn();
  const mockBatchSet = vi.fn();
  const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
  const mockWriteBatch = vi.fn(() => ({
    delete: mockBatchDelete,
    set: mockBatchSet,
    commit: mockBatchCommit,
  }));
  return {
    mockUnsubscribe: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockSetDoc: vi.fn(),
    mockDeleteDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockDoc: vi.fn(() => 'mock-doc-ref'),
    mockCollection: vi.fn(() => 'mock-collection-ref'),
    mockGetFirestore: vi.fn(() => 'mock-db'),
    mockWriteBatch,
    mockBatchDelete,
    mockBatchSet,
    mockBatchCommit,
  };
});

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: mockCollection,
  doc: mockDoc,
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  getDocs: mockGetDocs,
  writeBatch: mockWriteBatch,
}));

import {
  subscribeShoppingListItems,
  listShoppingListItems,
  saveShoppingListItem,
  deleteShoppingListItem,
  deleteShoppingListItems,
  moveShoppingListItems,
} from '../src/shoppingListItemSubscription.js';
import type { ShoppingListItem } from '@salt/domain';

type SnapCallback = (snap: { docs: Array<{ data: () => Record<string, unknown> }> }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

const ITEM_1: ShoppingListItem = {
  id: 'item-1',
  rawText: 'heinz baked beans 4 tins',
  notes: '',
  sources: [{ kind: 'manual' }],
  canonId: null,
  matchState: 'pending',
  checked: false,
  needsCheck: false,
  schemaVersion: 1,
  createdAt: '2026-05-14T10:00:00.000Z',
  updatedAt: '2026-05-14T10:00:00.000Z',
};

const ITEM_2: ShoppingListItem = {
  id: 'item-2',
  rawText: 'oat milk',
  notes: 'extra',
  sources: [{ kind: 'manual' }],
  canonId: 'canon-oat-milk',
  matchState: 'matched',
  checked: true,
  needsCheck: false,
  schemaVersion: 1,
  createdAt: '2026-05-14T10:00:00.000Z',
  updatedAt: '2026-05-14T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockBatchCommit.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
});

describe('subscribeShoppingListItems', () => {
  it('targets shoppingLists/{listId}/items subcollection', () => {
    subscribeShoppingListItems(
      'list-1',
      () => {},
      () => {},
    );
    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1', 'items');
  });

  it('returns the unsubscribe function from onSnapshot', () => {
    const unsub = subscribeShoppingListItems(
      'list-1',
      () => {},
      () => {},
    );
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('calls onItems with mapped items', () => {
    const onItems = vi.fn();
    subscribeShoppingListItems('list-1', onItems, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      docs: [
        {
          data: () => ({
            id: 'item-1',
            rawText: 'heinz baked beans 4 tins',
            notes: '',
            sources: [{ kind: 'manual' }],
            canonId: null,
            matchState: 'pending',
            checked: false,
            schemaVersion: 1,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:00:00.000Z',
          }),
        },
      ],
    });

    expect(onItems).toHaveBeenCalledWith([ITEM_1]);
  });

  it('maps recipe SourceRef with optional label', () => {
    const onItems = vi.fn();
    subscribeShoppingListItems('list-1', onItems, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      docs: [
        {
          data: () => ({
            id: 'item-r',
            rawText: 'flour',
            notes: '',
            sources: [{ kind: 'recipe', recipeId: 'recipe-1', servings: 4, label: 'Bread' }],
            canonId: 'canon-flour',
            matchState: 'matched',
            checked: false,
            schemaVersion: 1,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:00:00.000Z',
          }),
        },
      ],
    });

    const items = onItems.mock.calls[0][0] as ShoppingListItem[];
    expect(items[0]!.sources).toEqual([
      { kind: 'recipe', recipeId: 'recipe-1', servings: 4, label: 'Bread' },
    ]);
  });

  it('maps recipe SourceRef without optional label', () => {
    const onItems = vi.fn();
    subscribeShoppingListItems('list-1', onItems, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      docs: [
        {
          data: () => ({
            id: 'item-r',
            rawText: 'eggs',
            notes: '',
            sources: [{ kind: 'recipe', recipeId: 'recipe-2', servings: 2 }],
            canonId: null,
            matchState: 'pending',
            checked: false,
            schemaVersion: 1,
            createdAt: '',
            updatedAt: '',
          }),
        },
      ],
    });

    const items = onItems.mock.calls[0][0] as ShoppingListItem[];
    const src = items[0]!.sources[0]!;
    expect(src.kind).toBe('recipe');
    if (src.kind === 'recipe') {
      expect(src.label).toBeUndefined();
    }
  });

  it('defaults unknown matchState to pending', () => {
    const onItems = vi.fn();
    subscribeShoppingListItems('list-1', onItems, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      docs: [
        {
          data: () => ({
            id: 'item-x',
            rawText: 'x',
            notes: '',
            sources: [],
            canonId: null,
            matchState: 'unknown_future_value',
            checked: false,
            schemaVersion: 1,
            createdAt: '',
            updatedAt: '',
          }),
        },
      ],
    });

    const items = onItems.mock.calls[0][0] as ShoppingListItem[];
    expect(items[0]!.matchState).toBe('pending');
  });

  it('defaults missing sources to empty array', () => {
    const onItems = vi.fn();
    subscribeShoppingListItems('list-1', onItems, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({ docs: [{ data: () => ({ id: 'x', rawText: 'x' }) }] });

    const items = onItems.mock.calls[0][0] as ShoppingListItem[];
    expect(items[0]!.sources).toEqual([]);
  });

  it('calls onError with classified DomainError on permission-denied', () => {
    const onError = vi.fn();
    subscribeShoppingListItems('list-1', () => {}, onError);

    const errCb = mockOnSnapshot.mock.calls[0][2] as ErrorCallback;
    const raw = Object.assign(new Error('err'), { code: 'permission-denied' });
    errCb(raw);

    // onError forwards the raw error (real stack) alongside the classified kind.
    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' }, raw);
  });
});

describe('listShoppingListItems', () => {
  it('targets shoppingLists/{listId}/items subcollection', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await listShoppingListItems('list-1');
    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1', 'items');
  });

  it('returns success with mapped items', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          data: () => ({
            id: 'item-2',
            rawText: 'oat milk',
            notes: 'extra',
            sources: [{ kind: 'manual' }],
            canonId: 'canon-oat-milk',
            matchState: 'matched',
            checked: true,
            schemaVersion: 1,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:00:00.000Z',
          }),
        },
      ],
    });

    const result = await listShoppingListItems('list-1');
    expect(result).toEqual({ kind: 'ok', value: [ITEM_2] });
  });

  it('returns failure on Firestore error', async () => {
    mockGetDocs.mockRejectedValue(Object.assign(new Error('err'), { code: 'unauthenticated' }));
    const result = await listShoppingListItems('list-1');
    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });
  });
});

describe('saveShoppingListItem', () => {
  it('writes to shoppingLists/{listId}/items/{itemId}', async () => {
    await saveShoppingListItem('list-1', ITEM_1);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1', 'items', 'item-1');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...ITEM_1 });
  });

  it('returns success on write', async () => {
    const result = await saveShoppingListItem('list-1', ITEM_1);
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on Firestore error', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('err'), { code: 'permission-denied' }));
    const result = await saveShoppingListItem('list-1', ITEM_1);
    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });

  // Distributed-trace correlation (issue #362, Phase 5): when the browser passes a
  // W3C traceparent, it is stamped onto the doc as `traceContext` so the
  // onShoppingListItemWrite trigger can continue the browser-rooted trace.
  it('stamps traceContext on the doc when a traceparent is supplied', async () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    await saveShoppingListItem('list-1', ITEM_1, traceparent);
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', {
      ...ITEM_1,
      traceContext: traceparent,
    });
  });

  it('writes no traceContext field when no traceparent is supplied (back-compat)', async () => {
    await saveShoppingListItem('list-1', ITEM_1);
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...ITEM_1 });
    const written = mockSetDoc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(written).not.toHaveProperty('traceContext');
  });
});

describe('deleteShoppingListItem', () => {
  it('calls deleteDoc on shoppingLists/{listId}/items/{itemId}', async () => {
    await deleteShoppingListItem('list-1', 'item-1');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1', 'items', 'item-1');
    expect(mockDeleteDoc).toHaveBeenCalledWith('mock-doc-ref');
  });

  it('returns success on delete', async () => {
    const result = await deleteShoppingListItem('list-1', 'item-1');
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on Firestore error', async () => {
    mockDeleteDoc.mockRejectedValue(Object.assign(new Error('err'), { code: 'unavailable' }));
    const result = await deleteShoppingListItem('list-1', 'item-1');
    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'offline' } });
  });
});

describe('deleteShoppingListItems', () => {
  it('batches deletes for all itemIds', async () => {
    await deleteShoppingListItems('list-1', ['item-1', 'item-2']);
    expect(mockWriteBatch).toHaveBeenCalledWith('mock-db');
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
  });

  it('returns success on batch commit', async () => {
    const result = await deleteShoppingListItems('list-1', ['item-1', 'item-2']);
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns success with empty itemIds (no-op batch)', async () => {
    const result = await deleteShoppingListItems('list-1', []);
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on batch error', async () => {
    mockBatchCommit.mockRejectedValueOnce(
      Object.assign(new Error('err'), { code: 'permission-denied' }),
    );
    const result = await deleteShoppingListItems('list-1', ['item-1']);
    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });
});

describe('moveShoppingListItems', () => {
  it('batches deletes from source and sets on target', async () => {
    await moveShoppingListItems('list-src', 'list-tgt', [ITEM_1]);
    expect(mockWriteBatch).toHaveBeenCalledWith('mock-db');
    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledWith(expect.anything(), { ...ITEM_1 });
  });

  it('returns success on batch commit', async () => {
    const result = await moveShoppingListItems('list-src', 'list-tgt', [ITEM_1]);
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on batch error', async () => {
    mockBatchCommit.mockRejectedValueOnce(Object.assign(new Error('err'), { code: 'unavailable' }));
    const result = await moveShoppingListItems('list-src', 'list-tgt', [ITEM_1]);
    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'offline' } });
  });
});
