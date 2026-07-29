import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shop-day adapter (issue #629). The load-bearing claims: the week read is a
// RANGE OVER DOC IDS (no field index), the list contract is skip-invalid, and
// both writes cross the boundary as a Result rather than throwing (Rule 10).

const {
  mockUnsubscribe,
  mockOnSnapshot,
  mockSetDoc,
  mockDeleteDoc,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockDocumentId,
  mockGetFirestore,
} = vi.hoisted(() => ({
  mockUnsubscribe: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockSetDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
  mockDoc: vi.fn(() => 'mock-doc-ref'),
  mockCollection: vi.fn(() => 'mock-collection-ref'),
  mockQuery: vi.fn(() => 'mock-query'),
  mockWhere: vi.fn((...args: unknown[]) => ({ where: args })),
  mockDocumentId: vi.fn(() => '__name__'),
  mockGetFirestore: vi.fn(() => 'mock-db'),
}));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: mockCollection,
  doc: mockDoc,
  documentId: mockDocumentId,
  onSnapshot: mockOnSnapshot,
  query: mockQuery,
  where: mockWhere,
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
}));

import {
  subscribeShoppingDaysInRange,
  saveShoppingDay,
  deleteShoppingDay,
} from '../src/shoppingDaySync.js';
import type { ShoppingDayDoc } from '@salt/domain/schemas';

type SnapCallback = (snap: { docs: Array<{ id: string; data: () => unknown }> }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

const DAY: ShoppingDayDoc = {
  date: '2026-08-15',
  slot: 'am',
  schemaVersion: 1,
  setBy: 'uid-a',
  setAt: '2026-08-10T09:00:00.000Z',
};

function snapDoc(id: string, data: unknown) {
  return { id, data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
});

describe('subscribeShoppingDaysInRange', () => {
  it('ranges over doc ids, so no field index is needed', () => {
    const unsub = subscribeShoppingDaysInRange(
      '2026-08-10',
      '2026-08-16',
      () => {},
      () => {},
    );
    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'shoppingDays');
    expect(mockWhere).toHaveBeenCalledWith('__name__', '>=', '2026-08-10');
    expect(mockWhere).toHaveBeenCalledWith('__name__', '<=', '2026-08-16');
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('delivers the valid docs in the range', () => {
    const onDays = vi.fn();
    subscribeShoppingDaysInRange('2026-08-10', '2026-08-16', onDays, () => {});
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({ docs: [snapDoc(DAY.date, DAY)] });
    expect(onDays).toHaveBeenCalledWith([DAY]);
  });

  it('skips an invalid doc and still returns the valid subset', () => {
    // List-read contract: one corrupt doc must not blank the planner week.
    const onDays = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    subscribeShoppingDaysInRange('2026-08-10', '2026-08-16', onDays, onError);
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      docs: [snapDoc('bad', { date: 'whenever', slot: 'noon' }), snapDoc(DAY.date, DAY)],
    });
    expect(onDays).toHaveBeenCalledWith([DAY]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('surfaces a stream-level error as a classified DomainError', () => {
    const onError = vi.fn();
    subscribeShoppingDaysInRange('2026-08-10', '2026-08-16', () => {}, onError);
    const err = Object.assign(new Error('nope'), { code: 'permission-denied' });
    (mockOnSnapshot.mock.calls[0]![2] as ErrorCallback)(err);
    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' }, err);
  });
});

describe('saveShoppingDay', () => {
  it('keys the doc by the date', async () => {
    const result = await saveShoppingDay(DAY);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingDays', '2026-08-15');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...DAY });
    expect(result.kind).toBe('ok');
  });

  it('returns a Failure rather than throwing', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('nope'), { code: 'unavailable' }));
    const result = await saveShoppingDay(DAY);
    expect(result.kind).toBe('err');
  });
});

describe('deleteShoppingDay', () => {
  it('deletes the date-keyed doc', async () => {
    const result = await deleteShoppingDay('2026-08-15');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'shoppingDays', '2026-08-15');
    expect(mockDeleteDoc).toHaveBeenCalledWith('mock-doc-ref');
    expect(result.kind).toBe('ok');
  });

  it('returns a Failure rather than throwing', async () => {
    mockDeleteDoc.mockRejectedValue(Object.assign(new Error('nope'), { code: 'unavailable' }));
    const result = await deleteShoppingDay('2026-08-15');
    expect(result.kind).toBe('err');
  });
});
