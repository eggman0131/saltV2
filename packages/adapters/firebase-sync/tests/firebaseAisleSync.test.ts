import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

interface MockTx {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

let mockGetDoc = vi.fn<() => Promise<unknown>>();
let mockRunTransaction =
  vi.fn<(db: unknown, fn: (tx: MockTx) => Promise<unknown>) => Promise<unknown>>();

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ _col: col, _id: id })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  onSnapshot: vi.fn(() => () => {}),
}));

// Dynamic import AFTER mocks are registered
const { createFirebaseAisleSyncTransportAdapter } = await import('../src/firebaseAisleSync.js');

function makeAisle(id = 'a1', order = 0) {
  return { id, name: 'Produce', order };
}

function makeDocSnap(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => data ?? undefined,
  };
}

function makeTx(existingData?: Record<string, unknown> | null): MockTx {
  return {
    get: vi.fn().mockResolvedValue(makeDocSnap(existingData ?? null)),
    set: vi.fn(),
  };
}

function fbError(code: string): Error & { code: string } {
  const err = new Error(`Firestore: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  mockGetDoc = vi.fn<() => Promise<unknown>>();
  mockRunTransaction =
    vi.fn<(db: unknown, fn: (tx: MockTx) => Promise<unknown>) => Promise<unknown>>();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// pull — no document
// ---------------------------------------------------------------------------

describe('pull — no document', () => {
  it('returns null when document does not exist', async () => {
    mockGetDoc.mockResolvedValue(makeDocSnap(null));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result).toEqual({ kind: 'ok', value: null });
  });
});

// ---------------------------------------------------------------------------
// pull — cursor check
// ---------------------------------------------------------------------------

describe('pull — cursor check', () => {
  it('returns null when remote revision equals sinceCursor', async () => {
    mockGetDoc.mockResolvedValue(
      makeDocSnap({ schemaVersion: 1, revision: 5, updatedAt: '', aisles: [] }),
    );
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.pull(5);

    expect(result).toEqual({ kind: 'ok', value: null });
  });

  it('returns null when remote revision is less than sinceCursor', async () => {
    mockGetDoc.mockResolvedValue(
      makeDocSnap({ schemaVersion: 1, revision: 3, updatedAt: '', aisles: [] }),
    );
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.pull(5);

    expect(result).toEqual({ kind: 'ok', value: null });
  });

  it('returns AisleSyncBatch when remote revision exceeds sinceCursor', async () => {
    const aisles = [makeAisle()];
    mockGetDoc.mockResolvedValue(
      makeDocSnap({ schemaVersion: 1, revision: 8, updatedAt: '2026-01-01T00:00:00Z', aisles }),
    );
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.pull(5);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok' && result.value !== null) {
      expect(result.value.cursor).toBe(8);
      expect(result.value.aisles).toHaveLength(1);
    }
  });

  it('returns batch when sinceCursor is null (first pull)', async () => {
    const aisles = [makeAisle()];
    mockGetDoc.mockResolvedValue(
      makeDocSnap({ schemaVersion: 1, revision: 2, updatedAt: '', aisles }),
    );
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value).not.toBeNull();
      expect(result.value?.cursor).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// pull — error classification
// ---------------------------------------------------------------------------

describe('pull — error classification', () => {
  it('returns AuthError:forbidden on permission-denied', async () => {
    mockGetDoc.mockRejectedValue(fbError('permission-denied'));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });

  it('returns NetworkError:offline on unavailable', async () => {
    mockGetDoc.mockRejectedValue(fbError('unavailable'));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.pull(null);

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'offline' } });
  });
});

// ---------------------------------------------------------------------------
// push — success
// ---------------------------------------------------------------------------

describe('push — success', () => {
  it('returns ok when no remote document exists', async () => {
    const tx = makeTx(null);
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.push([makeAisle()], 0);

    expect(result.kind).toBe('ok');
    expect(tx.set).toHaveBeenCalledTimes(1);
  });

  it('returns ok when remote revision matches baseRevision', async () => {
    const tx = makeTx({ schemaVersion: 1, revision: 3, updatedAt: '', aisles: [] });
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.push([makeAisle()], 3);

    expect(result.kind).toBe('ok');
  });

  it('writes revision = baseRevision + 1', async () => {
    const tx = makeTx(null);
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    await adapter.push([makeAisle()], 4);

    const written = tx.set.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(written['revision']).toBe(5);
  });

  it('returns the written AislesDocument on success', async () => {
    const tx = makeTx(null);
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.push([makeAisle('a1')], 2);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.revision).toBe(3);
      expect(result.value.aisles).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// push — conflict on revision mismatch
// ---------------------------------------------------------------------------

describe('push — conflict', () => {
  it('returns conflict when remote revision differs from baseRevision', async () => {
    const tx = makeTx({ schemaVersion: 1, revision: 9, updatedAt: '', aisles: [] });
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.push([makeAisle()], 3);

    expect(result.kind).toBe('conflict');
    if (result.kind === 'conflict') {
      expect(result.local.revision).toBe(3);
      expect(result.remote.revision).toBe(9);
    }
  });

  it('does not write on conflict', async () => {
    const tx = makeTx({ schemaVersion: 1, revision: 9, updatedAt: '', aisles: [] });
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    await adapter.push([makeAisle()], 3);

    expect(tx.set).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// push — error classification
// ---------------------------------------------------------------------------

describe('push — error classification', () => {
  it('returns AuthError on permission-denied', async () => {
    mockRunTransaction.mockRejectedValue(fbError('permission-denied'));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    const result = await adapter.push([makeAisle()], 0);

    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });
});

// ---------------------------------------------------------------------------
// cross-scope isolation
// ---------------------------------------------------------------------------

describe('cross-scope isolation', () => {
  it('reads and writes canonData/aisles, not canonItems', async () => {
    const tx = makeTx(null);
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter();

    await adapter.push([makeAisle()], 0);

    // tx.get was called with the doc ref for canonData/aisles
    const docRef = tx.get.mock.calls[0]?.[0] as { _col: string; _id: string };
    expect(docRef._col).toBe('canonData');
    expect(docRef._id).toBe('aisles');
  });
});

// ---------------------------------------------------------------------------
// subscribe — delegates to manifest listener
// ---------------------------------------------------------------------------

describe('subscribe', () => {
  it('returns an unsubscribe function', () => {
    const adapter = createFirebaseAisleSyncTransportAdapter();
    const unsub = adapter.subscribe(
      () => {},
      () => {},
    );
    expect(typeof unsub).toBe('function');
  });
});
