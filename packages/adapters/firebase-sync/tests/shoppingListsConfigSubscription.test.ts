import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnsubscribe, mockOnSnapshot, mockSetDoc, mockGetDoc, mockDoc, mockGetFirestore } =
  vi.hoisted(() => ({
    mockUnsubscribe: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockSetDoc: vi.fn(),
    mockGetDoc: vi.fn(),
    mockDoc: vi.fn(() => 'mock-doc-ref'),
    mockGetFirestore: vi.fn(() => 'mock-db'),
  }));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  doc: mockDoc,
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
}));

import {
  subscribeShoppingListsConfig,
  loadShoppingListsConfig,
  saveShoppingListsConfig,
} from '../src/shoppingListsConfigSubscription.js';
import type { ShoppingListsConfig } from '@salt/domain';

type SnapCallback = (snap: { exists: () => boolean; data: () => unknown }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

const CONFIG: ShoppingListsConfig = {
  defaultListId: 'list-1',
  schemaVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  vi.stubGlobal('navigator', { onLine: true });
});

describe('subscribeShoppingListsConfig', () => {
  it('targets shoppingListsConfig/singleton', () => {
    subscribeShoppingListsConfig(
      () => {},
      () => {},
    );
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingListsConfig', 'singleton');
  });

  it('returns the unsubscribe function from onSnapshot', () => {
    const unsub = subscribeShoppingListsConfig(
      () => {},
      () => {},
    );
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('calls onConfig(null) when document does not exist', () => {
    const onConfig = vi.fn();
    subscribeShoppingListsConfig(onConfig, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({ exists: () => false, data: () => undefined });

    expect(onConfig).toHaveBeenCalledWith(null);
  });

  it('calls onConfig with mapped config when document exists', () => {
    const onConfig = vi.fn();
    subscribeShoppingListsConfig(onConfig, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      exists: () => true,
      data: () => ({ defaultListId: 'list-1', schemaVersion: 1 }),
    });

    expect(onConfig).toHaveBeenCalledWith(CONFIG);
  });

  it('normalises missing defaultListId to empty string', () => {
    const onConfig = vi.fn();
    subscribeShoppingListsConfig(onConfig, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({ exists: () => true, data: () => ({}) });

    const [cfg] = onConfig.mock.calls[0] as [ShoppingListsConfig];
    expect(cfg.defaultListId).toBe('');
  });

  it('calls onError with classified DomainError on permission-denied', () => {
    const onError = vi.fn();
    subscribeShoppingListsConfig(() => {}, onError);

    const errCb = mockOnSnapshot.mock.calls[0][2] as ErrorCallback;
    errCb(Object.assign(new Error('err'), { code: 'permission-denied' }));

    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' });
  });

  it('calls onError with classified DomainError on unauthenticated', () => {
    const onError = vi.fn();
    subscribeShoppingListsConfig(() => {}, onError);

    const errCb = mockOnSnapshot.mock.calls[0][2] as ErrorCallback;
    errCb(Object.assign(new Error('err'), { code: 'unauthenticated' }));

    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'unauthenticated' });
  });
});

describe('loadShoppingListsConfig', () => {
  it('targets shoppingListsConfig/singleton', async () => {
    await loadShoppingListsConfig();
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingListsConfig', 'singleton');
  });

  it('returns success(null) when document does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    const result = await loadShoppingListsConfig();
    expect(result).toEqual({ kind: 'ok', value: null });
  });

  it('returns success with mapped config when document exists', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ defaultListId: 'list-1', schemaVersion: 1 }),
    });
    const result = await loadShoppingListsConfig();
    expect(result).toEqual({ kind: 'ok', value: CONFIG });
  });

  it('returns failure on Firestore error', async () => {
    mockGetDoc.mockRejectedValue(Object.assign(new Error('err'), { code: 'unauthenticated' }));
    const result = await loadShoppingListsConfig();
    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });
  });
});

describe('saveShoppingListsConfig', () => {
  it('writes to shoppingListsConfig/singleton', async () => {
    await saveShoppingListsConfig(CONFIG);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingListsConfig', 'singleton');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...CONFIG });
  });

  it('returns success on write', async () => {
    const result = await saveShoppingListsConfig(CONFIG);
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure on Firestore error', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('err'), { code: 'permission-denied' }));
    const result = await saveShoppingListsConfig(CONFIG);
    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });
});
