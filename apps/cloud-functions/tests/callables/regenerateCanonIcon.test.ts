import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn(async () => undefined);
const mockDoc = vi.fn(() => ({ update: mockUpdate }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
const DELETE_SENTINEL = Symbol('FieldValue.delete');

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  FieldValue: { delete: () => DELETE_SENTINEL },
}));

class FakeHttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

vi.mock('firebase-functions/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: FakeHttpsError,
}));

const { regenerateCanonIcon } = await import('../../src/callables/regenerateCanonIcon.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('regenerateCanonIcon callable', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      (regenerateCanonIcon as Function)({ auth: null, data: { canonId: 'c1' } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload', async () => {
    await expect(
      (regenerateCanonIcon as Function)({ auth: { uid: 'u1' }, data: { canonId: '' } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('clears the thumbnail (and any stale hint) for a signed-in caller', async () => {
    const result = await (regenerateCanonIcon as Function)({
      auth: { uid: 'u1' },
      data: { canonId: 'canon-123' },
    });

    expect(mockCollection).toHaveBeenCalledWith('canonItems');
    expect(mockDoc).toHaveBeenCalledWith('canon-123');
    expect(mockUpdate).toHaveBeenCalledWith({ thumbnail: null, iconHint: DELETE_SENTINEL });
    expect(result).toEqual({ ok: true });
  });

  it('carries an optional hint onto the doc', async () => {
    await (regenerateCanonIcon as Function)({
      auth: { uid: 'u1' },
      data: { canonId: 'canon-123', hint: 'show it as a tin' },
    });

    expect(mockUpdate).toHaveBeenCalledWith({ thumbnail: null, iconHint: 'show it as a tin' });
  });
});
