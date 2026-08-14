import { describe, it, expect, vi, beforeEach } from 'vitest';

// The observation photo (issue #812, phase 4). Three things are worth pinning and
// nothing else is: that the two guards refuse BEFORE anything is written, that the
// object lands at the two-segment path storage.rules actually matches, and that the
// document write is PARTIAL — a whole-document write here would clobber the note
// and the readings the user typed a moment earlier.
//
// Mocking follows regenerateRecipeImage.test.ts (onCall returns the raw handler, a
// fake HttpsError carrying `.code`, dynamic import after the mocks) and extends it
// with the Storage/sharp seam the image path needs — there was no callable-level
// precedent for that, so this is it: `firebase-admin/storage` down to `file().save()`
// and encodeHeroImage stubbed, because what is under test is the plumbing around the
// encoder, not the encoder (tests/imaging/encodeHeroImage.test.ts owns that).

const mockUpdate = vi.fn(async () => undefined);
const mockObservationDoc = vi.fn(() => ({ update: mockUpdate }));
const mockObservationsCollection = vi.fn(() => ({ doc: mockObservationDoc }));
const mockBatchDoc = vi.fn(() => ({ collection: mockObservationsCollection }));
const mockCollection = vi.fn(() => ({ doc: mockBatchDoc }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));

const mockSave = vi.fn(async () => undefined);
const mockFile = vi.fn(() => ({ save: mockSave }));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ name: 'demo-salt.appspot.com', file: mockFile }),
  }),
}));

const mockEncode = vi.fn(async () => Buffer.from('webp-bytes'));
vi.mock('../../src/imaging/encodeHeroImage.js', () => ({
  encodeHeroImage: (...args: unknown[]) => mockEncode(...(args as [])),
}));

const mockReport = vi.fn(async () => undefined);
vi.mock('../../src/observability/reportServerError.js', () => ({
  reportFlowError: (...args: unknown[]) => mockReport(...(args as [])),
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

const { setObservationImageUpload } =
  await import('../../src/callables/setObservationImageUpload.js');

const BATCH_ID = 'batch-8f21c0d4';
const OBSERVATION_ID = 'obs-3c19';
// A one-pixel PNG is plenty: the encoder is stubbed, so all that matters is that
// the base64 decodes to bytes.
const IMAGE_BASE64 = Buffer.from('a photograph of a crock').toString('base64');

function call(data: unknown, auth: unknown = { uid: 'uid-a' }) {
  return (setObservationImageUpload as unknown as Function)({ auth, data });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setObservationImageUpload callable', () => {
  it('rejects unauthenticated callers before writing anything', async () => {
    await expect(
      call({ batchId: BATCH_ID, observationId: OBSERVATION_ID, imageBase64: IMAGE_BASE64 }, null),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    // The guards throw before the try block, so a signed-out caller is never
    // reported as a defect.
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('rejects a payload missing the observation id', async () => {
    await expect(call({ batchId: BATCH_ID, imageBase64: IMAGE_BASE64 })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload rather than handing it to sharp', async () => {
    await expect(
      call({
        batchId: BATCH_ID,
        observationId: OBSERVATION_ID,
        imageBase64: 'A'.repeat(7_000_001),
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockEncode).not.toHaveBeenCalled();
  });

  // The two-segment path is the whole point of the storage.rules match: a
  // `{file}` wildcard matches one segment, so `batch-images/{file}` would never
  // fire on this object and the photo would be unreadable.
  it('saves the re-encoded photo at batch-images/{batchId}/{observationId}.webp', async () => {
    const result = await call({
      batchId: BATCH_ID,
      observationId: OBSERVATION_ID,
      imageBase64: IMAGE_BASE64,
    });

    expect(mockEncode).toHaveBeenCalledWith(Buffer.from(IMAGE_BASE64, 'base64'));
    expect(mockFile).toHaveBeenCalledWith(`batch-images/${BATCH_ID}/${OBSERVATION_ID}.webp`);
    expect(mockSave).toHaveBeenCalledWith(
      Buffer.from('webp-bytes'),
      expect.objectContaining({ contentType: 'image/webp' }),
    );
    expect(result).toEqual({ ok: true });
  });

  // PARTIAL, and on the subcollection document — not the run. A whole-document
  // write from here would clobber the note and readings the user typed a moment ago.
  it('stamps only the image onto the observation, in the subcollection', async () => {
    await call({
      batchId: BATCH_ID,
      observationId: OBSERVATION_ID,
      imageBase64: IMAGE_BASE64,
    });

    expect(mockCollection).toHaveBeenCalledWith('batches');
    expect(mockBatchDoc).toHaveBeenCalledWith(BATCH_ID);
    expect(mockObservationsCollection).toHaveBeenCalledWith('observations');
    expect(mockObservationDoc).toHaveBeenCalledWith(OBSERVATION_ID);
    expect(mockUpdate).toHaveBeenCalledWith({
      image: {
        url: expect.stringContaining(
          encodeURIComponent(`batch-images/${BATCH_ID}/${OBSERVATION_ID}.webp`),
        ),
        source: 'upload',
      },
    });
  });

  // An unreadable photo or a bucket that will not take it is a real failure and is
  // reported additively, then re-thrown so the callable's error path is unchanged.
  it('reports and re-throws an unexpected encode failure', async () => {
    const boom = new Error('sharp: unsupported image format');
    mockEncode.mockRejectedValueOnce(boom);

    await expect(
      call({ batchId: BATCH_ID, observationId: OBSERVATION_ID, imageBase64: IMAGE_BASE64 }),
    ).rejects.toBe(boom);
    expect(mockReport).toHaveBeenCalledWith(boom);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
