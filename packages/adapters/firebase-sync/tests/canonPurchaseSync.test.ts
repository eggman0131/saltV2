import { describe, it, expect, vi, beforeEach } from 'vitest';

// Purchase counts adapter (issue #726). The load-bearing claims: a gesture is
// ONE write however many items it carries, repeated canon ids accumulate rather
// than being de-duplicated, the write is a MERGING setDoc (updateDoc would
// reject the very first tick-off, when the document does not yet exist), an
// absent document reads as empty rather than as an error, and nothing throws
// across the boundary (Rule 10).

const { mockSetDoc, mockGetDoc, mockDoc, mockGetFirestore, mockIncrement } = vi.hoisted(() => ({
  mockSetDoc: vi.fn(),
  mockGetDoc: vi.fn(),
  mockDoc: vi.fn((_db: unknown, collection: string, id: string) => `${collection}/${id}`),
  mockGetFirestore: vi.fn(() => 'mock-db'),
  // Stand in for the SDK sentinel with something inspectable — the tests care
  // about the AMOUNT each transform carries.
  mockIncrement: vi.fn((n: number) => ({ __increment: n })),
}));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  doc: mockDoc,
  getDoc: mockGetDoc,
  setDoc: mockSetDoc,
  increment: mockIncrement,
}));

import { recordCanonPurchases, loadCanonPurchaseCounts } from '../src/canonPurchaseSync.js';

function snapshot(data: unknown | undefined) {
  return { exists: () => data !== undefined, data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
});

describe('recordCanonPurchases', () => {
  it('writes one merged document for the whole gesture, whatever its size', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `canon-${i}`);

    const result = await recordCanonPurchases(ids);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = mockSetDoc.mock.calls[0]!;
    expect(ref).toBe('canonData/purchaseCounts');
    expect(options).toEqual({ merge: true });
    expect(Object.keys((payload as { counts: object }).counts)).toHaveLength(30);
  });

  it('carries one increment transform per id, and an ISO lastAt alongside', async () => {
    await recordCanonPurchases(['canon-onion', 'canon-milk']);

    const [, payload] = mockSetDoc.mock.calls[0]!;
    const { counts, lastAt } = payload as {
      counts: Record<string, unknown>;
      lastAt: Record<string, string>;
    };
    expect(counts).toEqual({
      'canon-onion': { __increment: 1 },
      'canon-milk': { __increment: 1 },
    });
    expect(lastAt['canon-onion']).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(lastAt['canon-milk']).toBe(lastAt['canon-onion']);
  });

  it('accumulates a repeated id into one transform of two — a genuine double purchase', async () => {
    await recordCanonPurchases(['canon-onion', 'canon-milk', 'canon-onion']);

    const [, payload] = mockSetDoc.mock.calls[0]!;
    expect((payload as { counts: Record<string, unknown> }).counts).toEqual({
      'canon-onion': { __increment: 2 },
      'canon-milk': { __increment: 1 },
    });
  });

  it('writes nothing when the gesture carried no matched rows', async () => {
    const result = await recordCanonPurchases([]);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('returns a Failure rather than throwing when the write is rejected', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('nope'), { code: 'permission-denied' }));

    const result = await recordCanonPurchases(['canon-onion']);

    expect(result.kind).toBe('err');
  });
});

describe('loadCanonPurchaseCounts', () => {
  it('reads the stored maps', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({
        counts: { 'canon-onion': 12 },
        lastAt: { 'canon-onion': '2026-08-01T10:00:00Z' },
      }),
    );

    const result = await loadCanonPurchaseCounts();

    expect(result).toEqual({
      kind: 'ok',
      value: { counts: { 'canon-onion': 12 }, lastAt: { 'canon-onion': '2026-08-01T10:00:00Z' } },
    });
  });

  it('reads an absent document as empty — day one, not an error', async () => {
    mockGetDoc.mockResolvedValue(snapshot(undefined));

    const result = await loadCanonPurchaseCounts();

    expect(result).toEqual({ kind: 'ok', value: { counts: {}, lastAt: {} } });
  });

  it('returns StorageError/corruption on a malformed document (single-doc read contract)', async () => {
    mockGetDoc.mockResolvedValue(snapshot({ counts: { 'canon-onion': 'twelve' } }));

    const result = await loadCanonPurchaseCounts();

    expect(result).toEqual({ kind: 'err', error: { kind: 'StorageError', reason: 'corruption' } });
  });

  it('returns a Failure rather than throwing when the read is rejected', async () => {
    mockGetDoc.mockRejectedValue(Object.assign(new Error('nope'), { code: 'unavailable' }));

    const result = await loadCanonPurchaseCounts();

    expect(result.kind).toBe('err');
  });
});
