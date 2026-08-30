import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The shared regeneration write (issue #1054, Phase 3).
 *
 * `regenerateCanonIcon.test.ts` and `regenerateProductFormIcon.test.ts` already
 * cover this helper THROUGH their callables — auth, wire validation, the
 * collection and id each addresses. What they do not state is the property that
 * makes the server's half of the shared field set different from the client's,
 * and which the move to `@salt/domain`'s `iconRegenerationFields` could quietly
 * have broken:
 *
 *   this is a PARTIAL `.update()`, where an absent key means "leave it alone",
 *   so removing a stale hint must be an explicit `FieldValue.delete()` — and
 *   `iconHint` must NEVER be sent as `undefined`, which the Admin SDK rejects.
 *
 * The builder expresses "no steer" by omitting the key, so that translation step
 * lives here and is asserted here, over every input that reaches it. Asserting
 * on the update payload is right at this boundary: the written document IS the
 * observable output (UT-A1), exactly as the two callable suites already do.
 */

const mockUpdate = vi.fn(async () => undefined);
const mockDoc = vi.fn(() => ({ update: mockUpdate }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
const DELETE_SENTINEL = Symbol('FieldValue.delete');

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  FieldValue: { delete: () => DELETE_SENTINEL },
}));

const { requestIconRegeneration } = await import('../../src/callables/requestIconRegeneration.js');

const NOW = 1_700_000_000_000;

/** The single field map handed to `.update()`. */
function written(): Record<string, unknown> {
  expect(mockUpdate.mock.calls).toHaveLength(1);
  return (mockUpdate.mock.calls[0] as unknown as [Record<string, unknown>])[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('requestIconRegeneration — the update it writes', () => {
  it.each([['canonItems'], ['productForms']] as const)(
    'clears the thumbnail and stamps the nonce for %s',
    async (collection) => {
      await requestIconRegeneration(collection, 'id-1', undefined);

      expect(mockCollection).toHaveBeenCalledWith(collection);
      expect(mockDoc).toHaveBeenCalledWith('id-1');
      expect(written()).toEqual({
        thumbnail: null,
        iconRequestedAt: NOW,
        iconHint: DELETE_SENTINEL,
      });
    },
  );

  it('carries a hint instead of the delete when one is given', async () => {
    await requestIconRegeneration('canonItems', 'id-1', 'show it as a tin');

    expect(written()).toEqual({
      thumbnail: null,
      iconRequestedAt: NOW,
      iconHint: 'show it as a tin',
    });
  });

  // The wire schemas (`RegenerateCanonIconInputSchema`,
  // `RegenerateProductFormIconInputSchema`) declare `hint` as
  // `z.string().trim().max(200).optional()`, so a whitespace-only steer has
  // already become `''` by the time it reaches here. Both spellings of "nothing"
  // are asserted rather than assumed, because that equivalence is the whole
  // reason this phase is behaviour-preserving.
  it.each([
    ['absent', undefined],
    ['empty after the wire schema trimmed it', ''],
  ])('deletes a stale hint when the steer is %s', async (_name, hint) => {
    await requestIconRegeneration('canonItems', 'id-1', hint);

    expect(written().iconHint).toBe(DELETE_SENTINEL);
  });

  it('never sends a field set to undefined, for any input', async () => {
    // The Admin SDK rejects `undefined` outright, which is what makes this a
    // safety property rather than a style preference. Stated over the whole
    // input space this function accepts rather than for one example.
    for (const hint of [undefined, '', 'a steer']) {
      mockUpdate.mockClear();
      await requestIconRegeneration('canonItems', 'id-1', hint);
      for (const [key, value] of Object.entries(written())) {
        expect(value, `${key} for hint ${JSON.stringify(hint)}`).not.toBeUndefined();
      }
    }
  });
});
