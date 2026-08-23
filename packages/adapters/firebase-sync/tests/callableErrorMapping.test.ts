import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// End-to-end cover for issue #916 at the actual call sites: a Cloud Function 500
// must reach the caller as a REPORTABLE, server-flavoured failure, and a genuine
// offline failure must still reach it as a SUPPRESSED NetworkError.
//
// One wrapper per distinct shape:
//   • callIdentifyEquipment      — the plain wrapper, the commonest shape;
//   • callDrawEquipmentIcon      — a wrapper with a per-call-site override arm;
//   • callListPushoverDevices    — the private helper that had DRIFTED, handling
//                                  `unauthenticated` but never `permission-denied`.

const callableMock = vi.fn();
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => callableMock),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
}));
vi.mock('firebase/app', () => ({ getApp: vi.fn(() => ({})) }));

const { callIdentifyEquipment } = await import('../src/equipmentCallables.js');
const { callDrawEquipmentIcon } = await import('../src/equipmentIconSubscription.js');
const { callListPushoverDevices } = await import('../src/pushoverCallables.js');

function callableError(code: string): Error & { code: string } {
  const err = new Error(`Firebase: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

const CALLS = [
  ['callIdentifyEquipment', () => callIdentifyEquipment('KitchenAid')],
  [
    'callDrawEquipmentIcon',
    () => callDrawEquipmentIcon({ action: 'draw', itemId: 'i1', brief: 'a pan' }),
  ],
  ['callListPushoverDevices', () => callListPushoverDevices()],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  // Node ≥ 21 exposes navigator globally with onLine = false.
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(CALLS)('%s — a Cloud Function 500', (_name, invoke) => {
  it('comes back as a reportable StorageError, not "check your connection"', async () => {
    callableMock.mockRejectedValueOnce(callableError('functions/internal'));

    await expect(invoke()).resolves.toEqual({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });
  });
});

describe.each(CALLS)('%s — a genuine offline failure', (_name, invoke) => {
  it('still comes back as a SUPPRESSED NetworkError, because offline is checked first', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    // The callable SDK surfaces a failed fetch as `functions/internal` too — the
    // code alone cannot separate it from a server 500, which is why the ordering
    // matters.
    callableMock.mockRejectedValueOnce(callableError('functions/internal'));

    await expect(invoke()).resolves.toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });
  });
});

describe('callListPushoverDevices — the arm the drifted copy was missing', () => {
  it('maps a rules refusal to AuthError:forbidden rather than a network error', async () => {
    callableMock.mockRejectedValueOnce(callableError('functions/permission-denied'));

    await expect(callListPushoverDevices()).resolves.toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'forbidden' },
    });
  });
});

describe('callDrawEquipmentIcon — the override arm survives the consolidation', () => {
  it('keeps failed-precondition as the suppressed ValidationError', async () => {
    callableMock.mockRejectedValueOnce(callableError('functions/failed-precondition'));

    const result = await callDrawEquipmentIcon({ action: 'draw', itemId: 'i1', brief: 'a pan' });
    expect(result.kind).toBe('err');
    expect(result.kind === 'err' && result.error.kind).toBe('ValidationError');
  });
});
