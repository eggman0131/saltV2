/**
 * Shopping-list item reads — what the two contract nets do not hold (#928, #939).
 *
 * All six writers moved to `tests/writerContract.test.ts`: `saveShoppingListItem`
 * (both branches of the `traceContext` stamp, #362), `deleteShoppingListItem`,
 * the two batched forms and the empty-batch case. The subcollection path, the
 * unsubscribe, the delivered id set, another list's items as a decoy and the
 * corrupt-document skip moved to the `subscribeShoppingListItems` row of
 * `tests/subscriptionContract.emulator.test.ts`.
 *
 * What is left is what neither net can see: THE DELIVERED ITEM. The contract net
 * normalises every collection row to a list of ids — its own `projection` field
 * says as much — so nothing there notices what happens to the item's fields, and
 * this is the schema in the package with the most to lose:
 *
 *   • `sources[]` is a discriminated union with an optional label,
 *   • `originalText` is optional precisely so pre-#528 documents still PARSE
 *     (the list read skips what fails, so a required field would take every
 *     legacy row off the live list rather than merely losing its wording),
 *   • `matchState` falls back rather than refusing an unknown future value,
 *   • `sources` defaults rather than refusing its absence.
 *
 * Every one of those is a back-compat decision about production data, and every
 * one of them is invisible to a row that compares ids. They are a table here
 * rather than seven copied bodies (UT-D1).
 *
 * Plus the STREAM path and its arity — two arguments, the second the raw
 * Firestore error — which no emulator row drives, and `listShoppingListItems`,
 * the one-shot `getDocs` that `writerContract.test.ts` classifies as a `'read'`
 * and neither net covers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUnsubscribe, mockOnSnapshot, mockGetDocs, mockDoc, mockCollection, mockGetFirestore } =
  vi.hoisted(() => ({
    mockUnsubscribe: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockGetDocs: vi.fn(),
    mockDoc: vi.fn(() => 'mock-doc-ref'),
    mockCollection: vi.fn(() => 'mock-collection-ref'),
    mockGetFirestore: vi.fn(() => 'mock-db'),
  }));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

// The SDK boundary (UT-B3). The write primitives are declared because the module
// imports them; the writers answer to writerContract.test.ts.
vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: mockCollection,
  doc: mockDoc,
  onSnapshot: mockOnSnapshot,
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDocs: mockGetDocs,
  writeBatch: vi.fn(),
}));

import {
  subscribeShoppingListItems,
  listShoppingListItems,
} from '../src/shoppingListItemSubscription.js';
import type { ShoppingListItem } from '@salt/domain';

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
  mockGetDocs.mockResolvedValue({ docs: [] });
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** One stored document, and what the subscriber must end up holding. */
interface DeliveryCase {
  name: string;
  /** The document id the snapshot carries. Not always a field of the data. */
  docId: string;
  stored: Record<string, unknown>;
  assert: (items: ShoppingListItem[]) => void;
}

const deliveryCases: DeliveryCase[] = [
  {
    name: 'a manual item arrives exactly as it was stored',
    docId: 'item-1',
    stored: {
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
    },
    assert: (items) => expect(items).toEqual([ITEM_1]),
  },
  {
    name: 'a recipe source keeps its optional label',
    docId: 'item-r',
    stored: {
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
    },
    assert: (items) =>
      expect(items[0]!.sources).toEqual([
        { kind: 'recipe', recipeId: 'recipe-1', servings: 4, label: 'Bread' },
      ]),
  },
  {
    name: 'a recipe source without a label keeps none',
    docId: 'item-r',
    stored: {
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
    },
    assert: (items) =>
      expect(items[0]!.sources).toEqual([{ kind: 'recipe', recipeId: 'recipe-2', servings: 2 }]),
  },
  {
    name: 'a product-form item keeps its originalText (#528)',
    docId: 'item-lime',
    stored: {
      id: 'item-lime',
      rawText: 'lime juice',
      notes: '',
      sources: [{ kind: 'recipe', recipeId: 'recipe-1', servings: 2, label: 'Ceviche' }],
      canonId: 'canon-lime',
      matchState: 'matched',
      amount: 3,
      unit: 'count',
      checked: false,
      schemaVersion: 1,
      createdAt: '2026-07-17T10:00:00.000Z',
      updatedAt: '2026-07-17T10:00:00.000Z',
      originalText: ['juice of 2 limes', 'zest of 1 lime'],
    },
    assert: (items) =>
      expect(items[0]!.originalText).toEqual(['juice of 2 limes', 'zest of 1 lime']),
  },
  {
    name: 'a pre-#528 item without originalText is delivered, not skipped',
    docId: 'item-lime-old',
    // The field is optional precisely so this document still parses: the
    // subscription SKIPS what fails, so a required field would make every
    // pre-#528 row silently vanish from the live list rather than merely lose
    // its wording.
    stored: {
      id: 'item-lime-old',
      rawText: 'lime juice',
      notes: '',
      sources: [{ kind: 'recipe', recipeId: 'recipe-1', servings: 2 }],
      canonId: 'canon-lime',
      matchState: 'matched',
      amount: 3,
      unit: 'count',
      checked: false,
      schemaVersion: 1,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    },
    assert: (items) => {
      expect(items.map((i) => i.id)).toEqual(['item-lime-old']);
      expect(items[0]!.originalText).toBeUndefined();
    },
  },
  {
    name: 'an unknown matchState falls back to pending',
    docId: 'item-x',
    stored: {
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
    },
    assert: (items) => expect(items[0]!.matchState).toBe('pending'),
  },
  {
    name: 'missing sources default to an empty array',
    docId: 'item-bare',
    stored: { id: 'item-bare', rawText: 'x' },
    assert: (items) => expect(items[0]!.sources).toEqual([]),
  },
];

describe('subscribeShoppingListItems — the delivered item', () => {
  it.each(deliveryCases)('$name', ({ docId, stored, assert }) => {
    const delivered: ShoppingListItem[][] = [];
    subscribeShoppingListItems(
      'list-1',
      (items) => delivered.push(items),
      () => {},
    );

    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)(
      firstSnapshot([{ id: docId, data: () => stored }]),
    );

    expect(delivered).toHaveLength(1);
    assert(delivered[0]!);
  });
});

describe('subscribeShoppingListItems — the stream-error path', () => {
  it('classifies a stream error and forwards the raw one alongside it', () => {
    const calls: unknown[][] = [];
    subscribeShoppingListItems(
      'list-1',
      () => {},
      (...args) => calls.push(args),
    );

    const raw = Object.assign(new Error('err'), { code: 'permission-denied' });
    (mockOnSnapshot.mock.calls[0]![2] as ErrorCallback)(raw);

    // TWO arguments — see the header (#928 finding B2-009).
    expect(calls).toEqual([[{ kind: 'AuthError', reason: 'forbidden' }, raw]]);
  });
});

describe('listShoppingListItems', () => {
  it('reads the items subcollection of one list and returns them mapped', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: ITEM_2.id,
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

    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'shoppingLists', 'list-1', 'items');
    expect(result).toEqual({ kind: 'ok', value: [ITEM_2] });
  });

  it('returns a Failure (never throws) on a Firestore error', async () => {
    mockGetDocs.mockRejectedValue(Object.assign(new Error('err'), { code: 'unauthenticated' }));

    const result = await listShoppingListItems('list-1');

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });
  });
});
