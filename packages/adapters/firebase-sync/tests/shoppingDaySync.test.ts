/**
 * Shop-day reads (issue #629) — what the two contract nets do not hold (#928, #939).
 *
 * `saveShoppingDay` and `deleteShoppingDay` moved to
 * `tests/writerContract.test.ts`, which pins the date-keyed path and the whole
 * payload with `toEqual` and the classified `Failure` on three Firestore codes.
 * The delivered id set, the inclusive range ends, the days either side of it and
 * the corrupt-document skip moved to the `subscribeShoppingDaysInRange` row of
 * `tests/subscriptionContract.emulator.test.ts`, which seeds them against a real
 * emulator. Both are stronger than the mocked versions that used to be here.
 *
 * Two claims neither net can make survive:
 *
 *   1. THE RANGE IS OVER DOCUMENT IDS, not over the `date` FIELD. This is the
 *      load-bearing half of #629 — a `documentId()` range needs no index, while
 *      the field range that reads identically from outside needs one that
 *      `firestore.indexes.json` does not have. The emulator row cannot tell them
 *      apart: its fixtures set `date` to the document id, as production does, so
 *      both queries deliver exactly the same set. The constraint is the only
 *      place the difference is visible.
 *   2. THE DELIVERED DOCUMENT. The contract net normalises the row to a list of
 *      dates; nothing there would notice a projection that dropped `slot` or
 *      `setBy`.
 *
 * Plus the STREAM path and its arity — two arguments, the second the raw
 * Firestore error — which no emulator row drives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockUnsubscribe,
  mockOnSnapshot,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockDocumentId,
  mockGetFirestore,
} = vi.hoisted(() => ({
  mockUnsubscribe: vi.fn(),
  mockOnSnapshot: vi.fn(),
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

// The SDK boundary (UT-B3). `setDoc`/`deleteDoc` are declared because the module
// imports them; the writers answer to writerContract.test.ts.
vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: mockCollection,
  doc: mockDoc,
  documentId: mockDocumentId,
  onSnapshot: mockOnSnapshot,
  query: mockQuery,
  where: mockWhere,
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

import { subscribeShoppingDaysInRange } from '../src/shoppingDaySync.js';
import type { ShoppingDayDoc } from '@salt/domain/schemas';

type SnapDoc = { id: string; data: () => unknown };
type SnapCallback = (snap: QuerySnapshotDouble) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

/**
 * As much of a `QuerySnapshot` as the parse loop reads — BOTH halves of it.
 * `subscribeCollection` asks which documents changed (#939) and re-parses only
 * those, so a double carrying `docs` alone lies about the SDK and fails on
 * `snap.docChanges is not a function` rather than on any behaviour.
 */
interface QuerySnapshotDouble {
  docs: SnapDoc[];
  docChanges: () => { type: 'added'; doc: SnapDoc; oldIndex: number; newIndex: number }[];
}

/** Every document reported as `added` — which is what a real FIRST snapshot says. */
function firstSnapshot(docs: SnapDoc[]): QuerySnapshotDouble {
  return {
    docs,
    docChanges: () => docs.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })),
  };
}

const DAY: ShoppingDayDoc = {
  date: '2026-08-15',
  slot: 'am',
  schemaVersion: 1,
  setBy: 'uid-a',
  setAt: '2026-08-10T09:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subscribeShoppingDaysInRange', () => {
  it('ranges over doc ids, so no field index is needed', () => {
    subscribeShoppingDaysInRange(
      '2026-08-10',
      '2026-08-16',
      () => {},
      () => {},
    );

    // The whole constraint list, in order: exactly two bounds, both inclusive,
    // both on `documentId()` (which the mock renders as `__name__`). A third
    // constraint, a strict comparison, or a swap to the `date` field all change
    // this value — and the last of those is invisible to the emulator row,
    // because the id and the field carry the same string in production.
    expect(mockWhere.mock.calls).toEqual([
      ['__name__', '>=', '2026-08-10'],
      ['__name__', '<=', '2026-08-16'],
    ]);
  });

  it('delivers each day in the range exactly as it was stored', () => {
    const delivered: ShoppingDayDoc[][] = [];
    subscribeShoppingDaysInRange(
      '2026-08-10',
      '2026-08-16',
      (days) => delivered.push(days),
      () => {},
    );

    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)(
      firstSnapshot([{ id: DAY.date, data: () => DAY }]),
    );

    // Whole-object equality: the emulator row compares dates, so a projection
    // that dropped `slot` or `setBy` would be invisible to it.
    expect(delivered).toEqual([[DAY]]);
  });

  it('classifies a stream error and forwards the raw one alongside it', () => {
    const calls: unknown[][] = [];
    subscribeShoppingDaysInRange(
      '2026-08-10',
      '2026-08-16',
      () => {},
      (...args) => calls.push(args),
    );

    const err = Object.assign(new Error('nope'), { code: 'permission-denied' });
    (mockOnSnapshot.mock.calls[0]![2] as ErrorCallback)(err);

    // TWO arguments — see the header (#928 finding B2-009).
    expect(calls).toEqual([[{ kind: 'AuthError', reason: 'forbidden' }, err]]);
  });
});
