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

const { regenerateRecipeImage } = await import('../../src/callables/regenerateRecipeImage.js');

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('regenerateRecipeImage callable', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      (regenerateRecipeImage as Function)({ auth: null, data: { recipeId: 'r1' } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload', async () => {
    await expect(
      (regenerateRecipeImage as Function)({ auth: { uid: 'u1' }, data: { recipeId: '' } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('clears the image, un-hides, and drops any stale hint for a signed-in caller', async () => {
    const result = await (regenerateRecipeImage as Function)({
      auth: { uid: 'u1' },
      data: { recipeId: 'recipe-123' },
    });

    expect(mockCollection).toHaveBeenCalledWith('recipes');
    expect(mockDoc).toHaveBeenCalledWith('recipe-123');
    expect(mockUpdate).toHaveBeenCalledWith({
      image: null,
      imageHidden: DELETE_SENTINEL,
      imageHint: DELETE_SENTINEL,
      imageRequestedAt: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it('carries an optional hint onto the doc', async () => {
    await (regenerateRecipeImage as Function)({
      auth: { uid: 'u1' },
      data: { recipeId: 'recipe-123', hint: 'make it brighter' },
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      image: null,
      imageHidden: DELETE_SENTINEL,
      imageHint: 'make it brighter',
      imageRequestedAt: NOW,
    });
  });
});
