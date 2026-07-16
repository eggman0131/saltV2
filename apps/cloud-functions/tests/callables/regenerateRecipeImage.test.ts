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

  it('clears the image, un-hides, and clears the brief when none is supplied', async () => {
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
      imageBrief: DELETE_SENTINEL,
      imageRequestedAt: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it('writes the supplied brief to imageBrief for the trigger to use verbatim', async () => {
    const brief = 'Served in a deep bowl on a sunlit table, steam rising, shot from above.';
    await (regenerateRecipeImage as Function)({
      auth: { uid: 'u1' },
      data: { recipeId: 'recipe-123', brief },
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      image: null,
      imageHidden: DELETE_SENTINEL,
      imageHint: DELETE_SENTINEL,
      imageBrief: brief,
      imageRequestedAt: NOW,
    });
  });

  // A user who empties the box is asking for fresh art direction, not for the old
  // brief to be quietly reused — so an absent brief must delete the field, which is
  // what routes the trigger back to authoring one.
  it('deletes a stale imageBrief when the caller clears the box', async () => {
    await (regenerateRecipeImage as Function)({
      auth: { uid: 'u1' },
      data: { recipeId: 'recipe-123', brief: '   ' },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ imageBrief: DELETE_SENTINEL }),
    );
  });

  // imageHint is retired: never written, but still cleared, because a doc may carry
  // one from an in-flight client. An older bundle's hint must not fail the call and
  // must not leak into the generation.
  it('accepts but ignores a hint from an older client, and never writes one', async () => {
    const result = await (regenerateRecipeImage as Function)({
      auth: { uid: 'u1' },
      data: { recipeId: 'recipe-123', hint: 'make it brighter' },
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ imageHint: DELETE_SENTINEL }),
    );
  });
});
