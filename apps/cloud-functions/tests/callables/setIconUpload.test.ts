import { describe, it, expect, vi, beforeEach } from 'vitest';

// Characterization net over the setIconUpload callable (issue #1006), written
// BEFORE its inline upload block is folded onto the shared icon pipeline. What is
// pinned: the refusal codes and messages byte-for-byte, the absent-doc refusal
// ORDER (before any Storage write), the four TARGETS pairs as literal strings (a
// changed prefix silently orphans Storage objects — the weekly sweep joins each
// prefix against its own collection), the 108 framing, that a photograph never
// goes through removeFlatBackground, and the partial two-field write-back.
//
// Mocking follows setObservationImageUpload.test.ts (onCall returns the raw
// handler, a fake HttpsError carrying `.code`, Storage down to `file().save()`,
// the sharp seam stubbed, dynamic import after mocks).

const mockUpdate = vi.fn(async () => undefined);
const mockDoc = vi.fn(() => ({ update: mockUpdate, get: mockGet }));
const mockGet = vi.fn(async () => ({ exists: true }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  FieldValue: { delete: () => Symbol.for('FieldValue.delete') },
}));

const mockSave = vi.fn(async () => undefined);
const mockFile = vi.fn(() => ({ save: mockSave }));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ name: 'demo-salt.appspot.com', file: mockFile }),
  }),
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

const mockNormalize = vi.fn(async () => Buffer.from('webp-bytes'));
vi.mock('../../src/imaging/normalizeIconFraming.js', () => ({
  normalizeIconFraming: (...args: unknown[]) => mockNormalize(...(args as [])),
}));

// Not in this callable's import graph at all — and that absence IS the pinned
// behavior (#892): removeFlatBackground's edge flood-fill is keyed to the flat
// generated fill and is unpredictable on a photograph. The mock exists so the
// "never called" assertion below fails loudly if a future fold of this callable
// onto shared pipeline code routes an upload through background removal.
const mockRemoveFlatBackground = vi.fn(async () => Buffer.from('cutout-bytes'));
vi.mock('../../src/imaging/removeFlatBackground.js', () => ({
  removeFlatBackground: (...args: unknown[]) => mockRemoveFlatBackground(...(args as [])),
}));

const { setIconUpload } = await import('../../src/callables/setIconUpload.js');

const IMAGE_BASE64 = Buffer.from('a photograph of a peeler').toString('base64');
const NOW = 1_700_000_000_000;

function call(data: unknown, auth: unknown = { uid: 'uid-a' }) {
  return (setIconUpload as unknown as Function)({ auth, data });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('setIconUpload callable', () => {
  it('rejects unauthenticated callers before writing anything', async () => {
    await expect(
      call({ family: 'canon', id: 'c1', imageBase64: IMAGE_BASE64 }, null),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with the exact wire message', async () => {
    await expect(
      call({ family: 'stationery', id: 'c1', imageBase64: IMAGE_BASE64 }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'Invalid request payload.' });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // The refusal ORDER is the behavior: a partial `.update()` on an absent doc
  // would throw anyway, but only AFTER the object landed in Storage — stranding
  // an orphan the weekly sweep would then have to collect.
  it('refuses an absent document before any Storage write, with the exact wire message', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });

    await expect(
      call({ family: 'equipment', id: 'eq-1', imageBase64: IMAGE_BASE64 }),
    ).rejects.toMatchObject({
      code: 'not-found',
      message: 'There is nothing here to put a picture on yet.',
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // The four (collection, prefix) pairs as LITERAL strings, deliberately not
  // imported from the source: the weekly orphan sweep joins each prefix against
  // its own collection, so a transcription slip here must fail the suite rather
  // than follow the source.
  it.each([
    { family: 'canon', collection: 'canonItems', prefix: 'canon-icons' },
    { family: 'productForm', collection: 'productForms', prefix: 'product-form-icons' },
    { family: 'kitchenTool', collection: 'kitchenTools', prefix: 'kit-icons' },
    { family: 'equipment', collection: 'equipmentIcons', prefix: 'equipment-icons' },
  ])(
    'writes a $family upload to $prefix/{id}.webp on $collection',
    async ({ family, collection, prefix }) => {
      const result = await call({ family, id: 'item-1', imageBase64: IMAGE_BASE64 });

      expect(mockCollection).toHaveBeenCalledWith(collection);
      expect(mockDoc).toHaveBeenCalledWith('item-1');
      expect(mockFile).toHaveBeenCalledWith(`${prefix}/item-1.webp`);
      expect(mockSave).toHaveBeenCalledWith(Buffer.from('webp-bytes'), {
        contentType: 'image/webp',
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      });
      // Partial update: the picture plus the cache-bust nonce, and NOTHING else — a
      // whole-doc write would clobber a synonym or brief typed a moment ago (LWW).
      expect(mockUpdate).toHaveBeenCalledWith({
        thumbnail: expect.stringContaining(encodeURIComponent(`${prefix}/item-1.webp`)),
        iconRequestedAt: NOW,
      });
      // The download-endpoint URL (governed by storage.rules), never the raw GCS form.
      const stamped = (mockUpdate.mock.calls[0]?.[0] as { thumbnail: string }).thumbnail;
      expect(stamped).toMatch(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//);
      expect(result).toEqual({ ok: true });
    },
  );

  it('frames the photograph at the canon 108 and never strips its background', async () => {
    await call({ family: 'canon', id: 'c1', imageBase64: IMAGE_BASE64 });

    expect(mockNormalize).toHaveBeenCalledWith(Buffer.from(IMAGE_BASE64, 'base64'), {
      contentMax: 108,
    });
    expect(mockRemoveFlatBackground).not.toHaveBeenCalled();
  });
});
