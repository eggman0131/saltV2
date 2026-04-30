import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

// Mutable refs so each test can configure the behaviour
let mockSetDoc = vi.fn<() => Promise<void>>();
let mockGetDocs = vi.fn<() => Promise<unknown>>();

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, name: string) => ({ _path: name })),
  doc: vi.fn((_db: unknown, _col: string, id: string) => ({ _id: id })),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  onSnapshot: vi.fn(),
}));

// Dynamic import AFTER mocks are registered
const { createFirebaseCanonSyncTransportAdapter } =
  await import('../src/firebaseCanonSyncTransport.js');

function makeItem(id = 'item-1') {
  return {
    id,
    name: 'Tomato',
    synonyms: [] as string[],
    aisle: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
  };
}

function fbError(code: string): Error & { code: string } {
  const err = new Error(`Firestore: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  vi.useFakeTimers();
  // Node.js ≥ v21 exposes navigator.onLine = false by default; stub to true
  // so error classification isn't short-circuited to NetworkError:offline.
  vi.stubGlobal('navigator', { onLine: true });
  mockSetDoc = vi.fn<() => Promise<void>>();
  mockGetDocs = vi.fn<() => Promise<unknown>>();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// push — success paths
// ---------------------------------------------------------------------------

describe('push — success', () => {
  it('returns ok on first attempt when Firestore resolves', async () => {
    mockSetDoc.mockResolvedValue(undefined);
    const adapter = createFirebaseCanonSyncTransportAdapter();
    const item = makeItem();

    const result = await adapter.push(item);

    expect(result).toEqual({ kind: 'ok', value: item });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it('sets pending.push to false after success', async () => {
    mockSetDoc.mockResolvedValue(undefined);
    const adapter = createFirebaseCanonSyncTransportAdapter();

    await adapter.push(makeItem());

    expect(adapter.pending.push).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// push — retry paths
// ---------------------------------------------------------------------------

describe('push — retry on retryable errors', () => {
  it('retries on NetworkError:offline and succeeds on the second attempt', async () => {
    mockSetDoc.mockRejectedValueOnce(fbError('unavailable')).mockResolvedValue(undefined);
    const adapter = createFirebaseCanonSyncTransportAdapter();
    const item = makeItem();

    const pushPromise = adapter.push(item);
    // Advance past the first retry delay (500 ms base)
    await vi.advanceTimersByTimeAsync(600);
    const result = await pushPromise;

    expect(result).toEqual({ kind: 'ok', value: item });
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });

  it('retries on NetworkError:transient (deadline-exceeded)', async () => {
    mockSetDoc.mockRejectedValueOnce(fbError('deadline-exceeded')).mockResolvedValue(undefined);
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const pushPromise = adapter.push(makeItem());
    await vi.advanceTimersByTimeAsync(600);
    const result = await pushPromise;

    expect(result.kind).toBe('ok');
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// push — exhaustion paths
// ---------------------------------------------------------------------------

describe('push — retry exhaustion', () => {
  it('returns failure after exhausting MAX_RETRIES (4) on persistent offline error', async () => {
    mockSetDoc.mockRejectedValue(fbError('unavailable'));
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
    expect(mockSetDoc).toHaveBeenCalledTimes(5);
  });

  it('sets pending.push = false after retry exhaustion', async () => {
    mockSetDoc.mockRejectedValue(fbError('unavailable'));
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
    mockSetDoc.mockRejectedValue(fbError('permission-denied'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.push(makeItem());

    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it('does not retry on AuthError:unauthenticated', async () => {
    mockSetDoc.mockRejectedValue(fbError('unauthenticated'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.push(makeItem());

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it('does not retry on StorageError (unknown code)', async () => {
    mockSetDoc.mockRejectedValue(new Error('unknown'));
    const adapter = createFirebaseCanonSyncTransportAdapter();

    const result = await adapter.push(makeItem());

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
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
