import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DomainError } from '@salt/shared-types';
import type { ErrorReportingPort } from '@salt/domain';

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

interface MockTx {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

let mockGetDocs = vi.fn<() => Promise<unknown>>();
let mockGetDoc = vi.fn<() => Promise<unknown>>();
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
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  onSnapshot: vi.fn(() => () => {}),
}));

const { createFirebaseCanonSyncTransportAdapter } =
  await import('../src/firebaseCanonSyncTransport.js');
const { createFirebaseAisleSyncTransportAdapter } = await import('../src/firebaseAisleSync.js');

function fbError(code: string): Error & { code: string } {
  const err = new Error(`Firestore: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

function makeReporter(): { port: ErrorReportingPort; reported: unknown[] } {
  const reported: unknown[] = [];
  return {
    port: {
      report(error: unknown): void {
        reported.push(error);
      },
    },
    reported,
  };
}

// A closed-set DomainError predicate: must be a plain object whose `kind`
// is one of the seven categories defined in shared-types §7.2.
function isDomainError(value: unknown): value is DomainError {
  if (value === null || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === 'AuthError' ||
    kind === 'NotFound' ||
    kind === 'NetworkError' ||
    kind === 'StorageError' ||
    kind === 'SyncError' ||
    kind === 'ConflictError' ||
    kind === 'ValidationError'
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  mockGetDocs = vi.fn<() => Promise<unknown>>();
  mockGetDoc = vi.fn<() => Promise<unknown>>();
  mockRunTransaction =
    vi.fn<(db: unknown, fn: (tx: MockTx) => Promise<unknown>) => Promise<unknown>>();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// firebaseCanonSyncTransport — adapter boundary §7.6
// ---------------------------------------------------------------------------

describe('firebaseCanonSyncTransport — port-boundary observability (§7.6)', () => {
  it('reports a DomainError (not a Firestore Error) on pull failure', async () => {
    const { port, reported } = makeReporter();
    mockGetDocs.mockRejectedValue(fbError('permission-denied'));
    const adapter = createFirebaseCanonSyncTransportAdapter(port);

    await adapter.pull(null);

    expect(reported).toHaveLength(1);
    const v = reported[0];
    expect(isDomainError(v)).toBe(true);
    expect(v).not.toBeInstanceOf(Error);
    expect(v).toEqual({ kind: 'AuthError', reason: 'forbidden' });
  });

  it('reports NetworkError category for transient Firestore failures', async () => {
    const { port, reported } = makeReporter();
    mockGetDocs.mockRejectedValue(fbError('unavailable'));
    const adapter = createFirebaseCanonSyncTransportAdapter(port);

    const pullPromise = adapter.pull(null);
    await vi.advanceTimersByTimeAsync(8000);
    await pullPromise;

    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual({ kind: 'NetworkError', reason: 'offline' });
  });

  it('reports StorageError category for unknown Firestore codes', async () => {
    const { port, reported } = makeReporter();
    mockRunTransaction.mockRejectedValue(new Error('something exotic'));
    const adapter = createFirebaseCanonSyncTransportAdapter(port);

    await adapter.push({
      id: 'x',
      schemaVersion: 2,
      name: 'x',
      synonyms: [],
      aisleId: null,
      thumbnail: null,
      embedding: null,
      needs_approval: false,
      updatedAt: '',
      revision: 0,
      deletedAt: null,
    });

    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual({ kind: 'StorageError', reason: 'unavailable' });
  });

  it('does NOT report on conflict — conflicts route to canonConflicts, not telemetry', async () => {
    const { port, reported } = makeReporter();
    const tx: MockTx = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ id: 'x', revision: 99 }),
      }),
      set: vi.fn(),
    };
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseCanonSyncTransportAdapter(port);

    const result = await adapter.push({
      id: 'x',
      schemaVersion: 2,
      name: 'x',
      synonyms: [],
      aisleId: null,
      thumbnail: null,
      embedding: null,
      needs_approval: false,
      updatedAt: '',
      revision: 1,
      deletedAt: null,
    });

    expect(result.kind).toBe('conflict');
    expect(reported).toHaveLength(0);
  });

  it('does NOT report on success', async () => {
    const { port, reported } = makeReporter();
    mockGetDocs.mockResolvedValue({ docs: [] });
    const adapter = createFirebaseCanonSyncTransportAdapter(port);

    await adapter.pull(null);

    expect(reported).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// firebaseAisleSync — adapter boundary §7.6
// ---------------------------------------------------------------------------

describe('firebaseAisleSync — port-boundary observability (§7.6)', () => {
  it('reports a DomainError (not a Firestore Error) on pull failure', async () => {
    const { port, reported } = makeReporter();
    mockGetDoc.mockRejectedValue(fbError('permission-denied'));
    const adapter = createFirebaseAisleSyncTransportAdapter(port);

    await adapter.pull(null);

    expect(reported).toHaveLength(1);
    const v = reported[0];
    expect(isDomainError(v)).toBe(true);
    expect(v).not.toBeInstanceOf(Error);
    expect(v).toEqual({ kind: 'AuthError', reason: 'forbidden' });
  });

  it('reports NetworkError category on transient Firestore failures', async () => {
    const { port, reported } = makeReporter();
    mockGetDoc.mockRejectedValue(fbError('unavailable'));
    const adapter = createFirebaseAisleSyncTransportAdapter(port);

    await adapter.pull(null);

    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual({ kind: 'NetworkError', reason: 'offline' });
  });

  it('reports StorageError category on push for unknown Firestore codes', async () => {
    const { port, reported } = makeReporter();
    mockRunTransaction.mockRejectedValue(new Error('exotic'));
    const adapter = createFirebaseAisleSyncTransportAdapter(port);

    await adapter.push([], 0);

    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual({ kind: 'StorageError', reason: 'unavailable' });
  });

  it('does NOT report on conflict — conflicts route to aisleConflicts, not telemetry', async () => {
    const { port, reported } = makeReporter();
    const tx: MockTx = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ schemaVersion: 1, revision: 99, updatedAt: '', aisles: [] }),
      }),
      set: vi.fn(),
    };
    mockRunTransaction.mockImplementation(async (_db, fn) => fn(tx));
    const adapter = createFirebaseAisleSyncTransportAdapter(port);

    const result = await adapter.push([], 1);

    expect(result.kind).toBe('conflict');
    expect(reported).toHaveLength(0);
  });

  it('does NOT report on success', async () => {
    const { port, reported } = makeReporter();
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    const adapter = createFirebaseAisleSyncTransportAdapter(port);

    await adapter.pull(null);

    expect(reported).toHaveLength(0);
  });
});
