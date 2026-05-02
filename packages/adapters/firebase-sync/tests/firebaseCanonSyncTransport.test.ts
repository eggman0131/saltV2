import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

interface MockTx {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

let mockGetDocs = vi.fn<() => Promise<unknown>>();
let mockRunTransaction =
  vi.fn<(db: unknown, fn: (tx: MockTx) => Promise<unknown>) => Promise<unknown>>();

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, name: string) => ({ _path: name })),
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ _col: col, _id: id })),
  query: vi.fn((...args: unknown[]) => ({ _query: args })),
  where: vi.fn((...args: unknown[]) => ({ _where: args })),
  orderBy: vi.fn((...args: unknown[]) => ({ _orderBy: args })),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  onSnapshot: vi.fn(() => () => {}),
}));

// Dynamic import AFTER mocks are registered
const { createFirebaseCanonSyncTransportAdapter } =
  await import('../src/firebaseCanonSyncTransport.js');

function makeItem(
  id = 'item-1',
  overrides: Partial<{ revision: number; deletedAt: string | null }> = {},
) {
  return {
    id,
    schemaVersion: 2 as const,
    name: 'Tomato',
    synonyms: [] as string[],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    revision: 0,
    deletedAt: null,
    ...overrides,
  };
}

function makeSnap(items: ReturnType<typeof makeItem>[]) {
  return {
    docs: items.map((item) => ({ data: () => item })),
  };
}

function makeTx(existingData?: Record<string, unknown> | null): MockTx {
  return {
    get: vi.fn().mockResolvedValue({
      exists: () => existingData != null,
      data: () => existingData,
    }),
    set: vi.fn(),
  };
}

function fbError(code: string): Error & { code: string } {
  const err = new Error(`Firestore: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  mockGetDocs = vi.fn<() => Promise<unknown>>();
  mockRunTransaction =
    vi.fn<(db: unknown, fn: (tx: MockTx) => Promise<unknown>) => Promise<unknown>>();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// pull — full pull (sinceCursor = null)
// ---------------------------------------------------------------------------

describe('pull — full pull (sinceCursor = null)', () => {
  it('returns empty batch with cursor=0 when no items exist', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([]));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result).toEqual({ kind: 'ok', value: { upserted: [], deleted: [], cursor: 0 } });
  });

  it('returns all items and sets cursor to the highest revision', async () => {
    const item1 = makeItem('a', { revision: 3 });
    const item2 = makeItem('b', { revision: 7 });
    mockGetDocs.mockResolvedValue(makeSnap([item1, item2]));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.upserted).toHaveLength(2);
      expect(result.value.cursor).toBe(7);
      expect(result.value.deleted).toEqual([]);
    }
  });

  it('includes tombstones (deletedAt != null) in upserted', async () => {
    const tombstone = makeItem('x', { revision: 5, deletedAt: '2026-01-01T00:00:00Z' });
    mockGetDocs.mockResolvedValue(makeSnap([tombstone]));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.upserted[0]?.deletedAt).toBe('2026-01-01T00:00:00Z');
    }
  });
});

// ---------------------------------------------------------------------------
// pull — delta pull (sinceCursor > 0)
// ---------------------------------------------------------------------------

describe('pull — delta pull (sinceCursor > 0)', () => {
  it('preserves sinceCursor when response is empty', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([]));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.pull(5);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.cursor).toBe(5);
    }
  });

  it('advances cursor to the revision of the last returned item', async () => {
    const item = makeItem('a', { revision: 8 });
    mockGetDocs.mockResolvedValue(makeSnap([item]));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.pull(5);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.cursor).toBe(8);
    }
  });
});

// ---------------------------------------------------------------------------
// pull — pending flag
// ---------------------------------------------------------------------------

describe('pull — pending flag', () => {
  it('sets pending.pull to false after success', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([]));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    await adapter.pull(null);

    expect(adapter.pending.pull).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pull — error classification
// ---------------------------------------------------------------------------

describe('pull — error classification', () => {
  it('returns NetworkError:offline when Firestore throws unavailable', async () => {
    mockGetDocs.mockRejectedValue(fbError('unavailable'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const pullPromise = adapter.pull(null);
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pullPromise;

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });
  });

  it('returns AuthError:forbidden when Firestore throws permission-denied', async () => {
    mockGetDocs.mockRejectedValue(fbError('permission-denied'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'forbidden' },
    });
  });
});

// ---------------------------------------------------------------------------
// push — success: new item (no remote doc)
// ---------------------------------------------------------------------------

describe('push — success (new item)', () => {
  it('returns ok when remote doc does not exist', async () => {
    const tx = makeTx(null);
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();
    const item = makeItem();

    const result = await adapter.push(item);

    expect(result).toEqual({ kind: 'ok', value: item });
    expect(tx.set).toHaveBeenCalledTimes(1);
  });

  it('writes revision = item.revision + 1 to Firestore', async () => {
    const tx = makeTx(null);
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();
    const item = makeItem('x', { revision: 3 });

    await adapter.push(item);

    const written = tx.set.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(written['revision']).toBe(4);
  });

  it('sets pending.push to false after success', async () => {
    const tx = makeTx(null);
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    await adapter.push(makeItem());

    expect(adapter.pending.push).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// push — success: existing item whose revision matches
// ---------------------------------------------------------------------------

describe('push — success (matching revision)', () => {
  it('returns ok when remote revision equals item revision', async () => {
    const tx = makeTx({ ...makeItem('a', { revision: 5 }) });
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();
    const item = makeItem('a', { revision: 5 });

    const result = await adapter.push(item);

    expect(result.kind).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// push — conflict on revision mismatch
// ---------------------------------------------------------------------------

describe('push — conflict', () => {
  it('returns conflict when remote revision differs from local', async () => {
    const localItem = makeItem('a', { revision: 2 });
    const tx = makeTx({ ...makeItem('a', { revision: 5 }) });
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.push(localItem);

    expect(result.kind).toBe('conflict');
    if (result.kind === 'conflict') {
      expect(result.local.revision).toBe(2);
      expect(result.remote.revision).toBe(5);
    }
  });

  it('does not write to Firestore on conflict', async () => {
    const localItem = makeItem('a', { revision: 1 });
    const tx = makeTx({ ...makeItem('a', { revision: 3 }) });
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    await adapter.push(localItem);

    expect(tx.set).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// push — retry on retryable errors
// ---------------------------------------------------------------------------

describe('push — retry on retryable errors', () => {
  it('retries on NetworkError:offline and succeeds on the second attempt', async () => {
    const tx = makeTx(null);
    mockRunTransaction
      .mockRejectedValueOnce(fbError('unavailable'))
      .mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const pushPromise = adapter.push(makeItem());
    await vi.advanceTimersByTimeAsync(600);
    const result = await pushPromise;

    expect(result.kind).toBe('ok');
    expect(mockRunTransaction).toHaveBeenCalledTimes(2);
  });

  it('retries on NetworkError:transient (deadline-exceeded)', async () => {
    const tx = makeTx(null);
    mockRunTransaction
      .mockRejectedValueOnce(fbError('deadline-exceeded'))
      .mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const pushPromise = adapter.push(makeItem());
    await vi.advanceTimersByTimeAsync(600);
    const result = await pushPromise;

    expect(result.kind).toBe('ok');
    expect(mockRunTransaction).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// push — retry exhaustion
// ---------------------------------------------------------------------------

describe('push — retry exhaustion', () => {
  it('returns failure after exhausting MAX_RETRIES (4) on persistent offline error', async () => {
    mockRunTransaction.mockRejectedValue(fbError('unavailable'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const pushPromise = adapter.push(makeItem());
    // Total sleep for 4 retries with base 500 ms doubling: 500 + 1000 + 2000 + 4000 = 7500 ms
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pushPromise;

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });
    // Initial call + 4 retries = 5 total
    expect(mockRunTransaction).toHaveBeenCalledTimes(5);
  });

  it('sets pending.push = false after retry exhaustion', async () => {
    mockRunTransaction.mockRejectedValue(fbError('unavailable'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const pushPromise = adapter.push(makeItem());
    await vi.advanceTimersByTimeAsync(8000);
    await pushPromise;

    expect(adapter.pending.push).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// push — non-retryable errors
// ---------------------------------------------------------------------------

describe('push — no retry on non-retryable errors', () => {
  it('does not retry on AuthError:forbidden (permission-denied)', async () => {
    mockRunTransaction.mockRejectedValue(fbError('permission-denied'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.push(makeItem());

    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not retry on AuthError:unauthenticated', async () => {
    mockRunTransaction.mockRejectedValue(fbError('unauthenticated'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.push(makeItem());

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not retry on unknown StorageError', async () => {
    mockRunTransaction.mockRejectedValue(new Error('unknown'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.push(makeItem());

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// subscribe — delegates to manifest listener
// ---------------------------------------------------------------------------

describe('subscribe — manifest listener', () => {
  it('returns an unsubscribe function', () => {
    const adapter = createFirebaseCanonSyncTransportAdapter();
    const unsub = adapter.subscribe(
      () => {},
      () => {},
    );
    expect(typeof unsub).toBe('function');
  });
});
