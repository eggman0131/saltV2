import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => makeFailingDb()),
  Timestamp: { now: vi.fn(() => ({ toDate: () => new Date('2026-05-02T00:00:00.000Z') })) },
}));

const loggerError = vi.fn();
const loggerInfo = vi.fn();

vi.mock('firebase-functions', () => ({
  logger: { info: loggerInfo, error: loggerError },
}));

const onDocumentWrittenHandlers: Array<{
  path: string;
  fn: (event: unknown) => Promise<void>;
}> = [];

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (path: string, fn: (event: unknown) => Promise<void>) => {
    onDocumentWrittenHandlers.push({ path, fn });
    return fn;
  },
}));

function makeFailingDb(): unknown {
  // Default db: any caller will get a transaction that throws permission-denied.
  return {
    doc: vi.fn().mockReturnValue({}),
    runTransaction: vi.fn().mockRejectedValue(fbAdminError('permission-denied')),
  };
}

function fbAdminError(code: string): Error & { code: string } {
  const err = new Error(`AdminFirestore: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

const fakeRef = { id: 'item-1' };

beforeEach(() => {
  loggerError.mockClear();
  loggerInfo.mockClear();
});

// Dynamic import after mocks land
const { onCanonItemWritten } = await import('../src/triggers/onCanonItemWritten.js');
const { onAislesWritten } = await import('../src/triggers/onAislesWritten.js');

void onCanonItemWritten;
void onAislesWritten;

function findHandler(path: string): (event: unknown) => Promise<void> {
  const h = onDocumentWrittenHandlers.find((x) => x.path === path);
  if (!h) throw new Error(`no handler registered for ${path}`);
  return h.fn;
}

function makeEvent(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  afterRef: unknown,
  paramId = 'item-1',
): unknown {
  return {
    params: { id: paramId },
    data: {
      before: { data: () => before },
      after: { data: () => after, ref: afterRef },
    },
  };
}

// ---------------------------------------------------------------------------
// onCanonItemWritten — structured error logging (§7.6 server-side)
// ---------------------------------------------------------------------------

describe('onCanonItemWritten — structured error logging', () => {
  it('logs { scope: "items", docId, errorCategory } on transaction failure', async () => {
    const handler = findHandler('canonItems/{id}');

    await expect(
      handler(makeEvent(undefined, { revision: 0 }, fakeRef, 'item-1')),
    ).rejects.toBeDefined();

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [msg, payload] = loggerError.mock.calls[0]!;
    expect(msg).toBe('onCanonItemWritten failed');
    expect(payload).toMatchObject({
      scope: 'items',
      docId: 'item-1',
      errorCategory: 'AuthError',
    });
  });

  it('errorCategory matches the DomainError taxonomy (closed-set string)', async () => {
    const handler = findHandler('canonItems/{id}');

    await expect(
      handler(makeEvent(undefined, { revision: 0 }, fakeRef, 'item-9')),
    ).rejects.toBeDefined();

    const payload = loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect([
      'AuthError',
      'NetworkError',
      'StorageError',
      'SyncError',
      'ValidationError',
      'NotFound',
      'ConflictError',
    ]).toContain(payload['errorCategory']);
  });

  it('does not embed the raw Error object in the structured payload', async () => {
    const handler = findHandler('canonItems/{id}');

    await expect(
      handler(makeEvent(undefined, { revision: 0 }, fakeRef, 'item-1')),
    ).rejects.toBeDefined();

    const payload = loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['err']).toBeUndefined();
    expect(payload['message']).toBeTypeOf('string');
  });
});

// ---------------------------------------------------------------------------
// onAislesWritten — structured error logging
// ---------------------------------------------------------------------------

describe('onAislesWritten — structured error logging', () => {
  it('logs { scope: "aisles", docId, errorCategory } on transaction failure', async () => {
    const handler = findHandler('canonData/aisles');

    await expect(handler(makeEvent(undefined, { revision: 0 }, fakeRef))).rejects.toBeDefined();

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [msg, payload] = loggerError.mock.calls[0]!;
    expect(msg).toBe('onAislesWritten failed');
    expect(payload).toMatchObject({
      scope: 'aisles',
      docId: 'canonData/aisles',
      errorCategory: 'AuthError',
    });
  });

  it('errorCategory matches the DomainError taxonomy', async () => {
    const handler = findHandler('canonData/aisles');

    await expect(handler(makeEvent(undefined, { revision: 0 }, fakeRef))).rejects.toBeDefined();

    const payload = loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect([
      'AuthError',
      'NetworkError',
      'StorageError',
      'SyncError',
      'ValidationError',
      'NotFound',
      'ConflictError',
    ]).toContain(payload['errorCategory']);
  });

  it('does not embed the raw Error object in the structured payload', async () => {
    const handler = findHandler('canonData/aisles');

    await expect(handler(makeEvent(undefined, { revision: 0 }, fakeRef))).rejects.toBeDefined();

    const payload = loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['err']).toBeUndefined();
    expect(payload['message']).toBeTypeOf('string');
  });
});

// ---------------------------------------------------------------------------
// classifyAdminFirestoreError — taxonomy mapping
// ---------------------------------------------------------------------------

describe('classifyAdminFirestoreError', () => {
  it('maps every supported admin Firestore code to a DomainError kind', async () => {
    const { classifyAdminFirestoreError } = await import('../src/triggers/errorCategory.js');
    expect(classifyAdminFirestoreError(fbAdminError('permission-denied'))).toBe('AuthError');
    expect(classifyAdminFirestoreError(fbAdminError('unauthenticated'))).toBe('AuthError');
    expect(classifyAdminFirestoreError(fbAdminError('unavailable'))).toBe('NetworkError');
    expect(classifyAdminFirestoreError(fbAdminError('deadline-exceeded'))).toBe('NetworkError');
    expect(classifyAdminFirestoreError(fbAdminError('resource-exhausted'))).toBe('StorageError');
    expect(classifyAdminFirestoreError(fbAdminError('data-loss'))).toBe('StorageError');
    expect(classifyAdminFirestoreError(fbAdminError('not-found'))).toBe('NotFound');
    expect(classifyAdminFirestoreError(fbAdminError('invalid-argument'))).toBe('ValidationError');
    expect(classifyAdminFirestoreError(new Error('mystery'))).toBe('StorageError');
  });
});
