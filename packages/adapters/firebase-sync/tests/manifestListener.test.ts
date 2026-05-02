import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

interface MockSnap {
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
}

type OnSnapshotSuccess = (snap: MockSnap) => void;
type OnSnapshotError = (err: unknown) => void;

let capturedDocRef: unknown = null;
let capturedSuccess: OnSnapshotSuccess | null = null;
let capturedError: OnSnapshotError | null = null;
let mockUnsubscribe: ReturnType<typeof vi.fn>;

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ _col: col, _id: id })),
  onSnapshot: vi.fn((ref: unknown, successCb: OnSnapshotSuccess, errorCb: OnSnapshotError) => {
    capturedDocRef = ref;
    capturedSuccess = successCb;
    capturedError = errorCb;
    mockUnsubscribe = vi.fn();
    return mockUnsubscribe;
  }),
}));

// Dynamic import AFTER mocks are registered
const { createFirebaseManifestListener } = await import('../src/firebaseManifestListener.js');

function fbError(code: string): Error & { code: string } {
  const err = new Error(`Firestore: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  capturedDocRef = null;
  capturedSuccess = null;
  capturedError = null;
  mockUnsubscribe = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// basic wiring
// ---------------------------------------------------------------------------

describe('createFirebaseManifestListener', () => {
  it('returns an unsubscribe function', () => {
    const unsub = createFirebaseManifestListener(
      () => {},
      () => {},
    );
    expect(typeof unsub).toBe('function');
  });

  it('calling unsubscribe invokes the onSnapshot unsubscribe', () => {
    const unsub = createFirebaseManifestListener(
      () => {},
      () => {},
    );
    unsub();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes to canonManifest/global', () => {
    createFirebaseManifestListener(
      () => {},
      () => {},
    );
    expect(capturedDocRef).toEqual({ _col: 'canonManifest', _id: 'global' });
  });
});

// ---------------------------------------------------------------------------
// ManifestTick emission
// ---------------------------------------------------------------------------

describe('ManifestTick emission', () => {
  it('emits tick with correct itemsRevision and aislesRevision', () => {
    const ticks: { itemsRevision: number; aislesRevision: number }[] = [];
    createFirebaseManifestListener(
      (tick) => ticks.push(tick),
      () => {},
    );

    capturedSuccess?.({
      exists: () => true,
      data: () => ({ itemsRevision: 3, aislesRevision: 7 }),
    });

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toEqual({ itemsRevision: 3, aislesRevision: 7 });
  });

  it('defaults itemsRevision and aislesRevision to 0 for missing fields', () => {
    const ticks: { itemsRevision: number; aislesRevision: number }[] = [];
    createFirebaseManifestListener(
      (tick) => ticks.push(tick),
      () => {},
    );

    capturedSuccess?.({ exists: () => true, data: () => ({}) });

    expect(ticks[0]).toEqual({ itemsRevision: 0, aislesRevision: 0 });
  });

  it('emits on every snapshot tick, not just the first', () => {
    const ticks: { itemsRevision: number; aislesRevision: number }[] = [];
    createFirebaseManifestListener(
      (tick) => ticks.push(tick),
      () => {},
    );

    capturedSuccess?.({
      exists: () => true,
      data: () => ({ itemsRevision: 1, aislesRevision: 0 }),
    });
    capturedSuccess?.({
      exists: () => true,
      data: () => ({ itemsRevision: 2, aislesRevision: 0 }),
    });

    expect(ticks).toHaveLength(2);
    expect(ticks[1]?.itemsRevision).toBe(2);
  });

  it('does not emit when manifest document does not exist yet', () => {
    const ticks: unknown[] = [];
    createFirebaseManifestListener(
      (tick) => ticks.push(tick),
      () => {},
    );

    capturedSuccess?.({ exists: () => false, data: () => undefined });

    expect(ticks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error classification', () => {
  it('calls onError with AuthError:forbidden on permission-denied', () => {
    const errors: unknown[] = [];
    createFirebaseManifestListener(
      () => {},
      (err) => errors.push(err),
    );

    capturedError?.(fbError('permission-denied'));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ kind: 'AuthError', reason: 'forbidden' });
  });

  it('calls onError with NetworkError:offline on unavailable', () => {
    const errors: unknown[] = [];
    createFirebaseManifestListener(
      () => {},
      (err) => errors.push(err),
    );

    capturedError?.(fbError('unavailable'));

    expect(errors).toEqual([{ kind: 'NetworkError', reason: 'offline' }]);
  });

  it('calls onError with AuthError:unauthenticated on unauthenticated', () => {
    const errors: unknown[] = [];
    createFirebaseManifestListener(
      () => {},
      (err) => errors.push(err),
    );

    capturedError?.(fbError('unauthenticated'));

    expect(errors).toEqual([{ kind: 'AuthError', reason: 'unauthenticated' }]);
  });
});
