import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUnsubscribe,
  mockOnSnapshot,
  mockSetDoc,
  mockDeleteDoc,
  mockGetDocs,
  mockUpdateDoc,
  mockDoc,
  mockCollection,
  mockGetFirestore,
} = vi.hoisted(() => ({
  mockUnsubscribe: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockSetDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockUpdateDoc: vi.fn(),
  mockDoc: vi.fn(() => 'mock-doc-ref'),
  mockCollection: vi.fn(() => 'mock-collection-ref'),
  mockGetFirestore: vi.fn(() => 'mock-db'),
}));

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
  updateDoc: mockUpdateDoc,
}));

import {
  subscribeShoppingLists,
  listShoppingLists,
  createShoppingList,
  renameShoppingList,
  deleteShoppingList,
} from '../src/shoppingListSubscription.js';
import type { ShoppingList } from '@salt/domain';

type SnapCallback = (snap: { docs: Array<{ data: () => Record<string, unknown> }> }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

const LIST_1: ShoppingList = {
  id: 'list-1',
  name: 'Weekly Shop',
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
  mockUpdateDoc.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
});

describe('subscribeShoppingLists', () => {
  it('targets the shoppingLists collection', () => {
    subscribeShoppingLists(
      () => {},
      () => {},
    );
    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'shoppingLists');
  });

  it('returns the unsubscribe function from onSnapshot', () => {
    const unsub = subscribeShoppingLists(
      () => {},
      () => {},
    );
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('calls onLists with mapped lists on snapshot', () => {
    const onLists = vi.fn();
    subscribeShoppingLists(onLists, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      docs: [
        {
          data: () => ({
            id: 'list-1',
            name: 'Weekly Shop',
            schemaVersion: 1,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:00:00.000Z',
          }),
        },
      ],
    });

    expect(onLists).toHaveBeenCalledWith([LIST_1]);
  });

  it('calls onLists with empty array when collection is empty', () => {
    const onLists = vi.fn();
    subscribeShoppingLists(onLists, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({ docs: [] });

    expect(onLists).toHaveBeenCalledWith([]);
  });

  it('normalises missing fields to safe defaults', () => {
    const onLists = vi.fn();
    subscribeShoppingLists(onLists, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({ docs: [{ data: () => ({}) }] });

    const [lists] = onLists.mock.calls[0] as [ShoppingList[]];
    expect(lists[0]).toEqual({
      id: '',
      name: '',
      schemaVersion: 1,
      createdAt: '',
      updatedAt: '',
    });
  });

  it('calls onError with classified DomainError on permission-denied', () => {
    const onError = vi.fn();
    subscribeShoppingLists(() => {}, onError);

    const errCb = mockOnSnapshot.mock.calls[0][2] as ErrorCallback;
    errCb(Object.assign(new Error('err'), { code: 'permission-denied' }));

    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' });
  });
});

describe('listShoppingLists', () => {
  it('targets the shoppingLists collection', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await listShoppingLists();
    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'shoppingLists');
  });

  it('returns success with mapped lists', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          data: () => ({
            id: 'list-1',
            name: 'Weekly Shop',
            schemaVersion: 1,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:00:00.000Z',
          }),
        },
      ],
    });

    const result = await listShoppingLists();
    expect(result).toEqual({ kind: 'ok', value: [LIST_1] });
  });

  it('returns failure on Firestore error', async () => {
    mockGetDocs.mockRejectedValue(Object.assign(new Error('err'), { code: 'unauthenticated' }));
    const result = await listShoppingLists();
    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });
  });
});

describe('createShoppingList', () => {
  it('writes to shoppingLists/{id}', async () => {
    await createShoppingList(LIST_1);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...LIST_1 });
  });

  it('returns success on write', async () => {
    const result = await createShoppingList(LIST_1);
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on Firestore error', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('err'), { code: 'permission-denied' }));
    const result = await createShoppingList(LIST_1);
    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });
});

describe('renameShoppingList', () => {
  it('calls updateDoc on shoppingLists/{id} with name and updatedAt', async () => {
    await renameShoppingList('list-1', 'Renamed', '2026-05-14T11:00:00.000Z');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1');
    expect(mockUpdateDoc).toHaveBeenCalledWith('mock-doc-ref', {
      name: 'Renamed',
      updatedAt: '2026-05-14T11:00:00.000Z',
    });
  });

  it('returns success on update', async () => {
    const result = await renameShoppingList('list-1', 'Renamed', '2026-05-14T11:00:00.000Z');
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on Firestore error', async () => {
    mockUpdateDoc.mockRejectedValue(Object.assign(new Error('err'), { code: 'unavailable' }));
    const result = await renameShoppingList('list-1', 'Renamed', '2026-05-14T11:00:00.000Z');
    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'offline' } });
  });
});

describe('deleteShoppingList', () => {
  it('calls deleteDoc on shoppingLists/{id}', async () => {
    await deleteShoppingList('list-1');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1');
    expect(mockDeleteDoc).toHaveBeenCalledWith('mock-doc-ref');
  });

  it('returns success on delete', async () => {
    const result = await deleteShoppingList('list-1');
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on Firestore error', async () => {
    mockDeleteDoc.mockRejectedValue(Object.assign(new Error('err'), { code: 'permission-denied' }));
    const result = await deleteShoppingList('list-1');
    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });
});
