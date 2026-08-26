import { describe, it, expect, vi, beforeEach } from 'vitest';

// Characterization net over the drawEquipmentIcon callable (issue #1006), written
// BEFORE the callable is folded onto the shared icon pipeline so the fold shows up
// as a green suite, not a judgment call. What is pinned: the refusal codes and
// messages byte-for-byte, the hide path's partial write, the fail-open kill
// switch (including the one drift this issue deliberately fixes — see the
// read-throw test), the exact Storage path/options/framing, and both arms of the
// write-back transaction.
//
// Mocking follows setObservationImageUpload.test.ts (onCall returns the raw
// handler, a fake HttpsError carrying `.code`, Storage down to `file().save()`,
// imaging seams stubbed, dynamic import after mocks). Seven `vi.mock` calls,
// above the UT-B1 cap of five, because this callable genuinely spans that many
// architectural seams and none can be narrowed: Firestore + Storage (admin SDK),
// the callable protocol (HttpsError/onCall), the Genkit flow (a live model call
// otherwise), the two sharp-backed imaging steps (owned by tests/imaging/), and
// the reporting port (whose call/non-call is itself behavior under test here).

const mockUpdate = vi.fn(async () => undefined);
const mockGet = vi.fn(async () => docSnap({ briefSourceName: 'Stand mixer' }));
const equipmentRef = { update: mockUpdate, get: mockGet };
const mockEquipmentDoc = vi.fn(() => equipmentRef);
const mockDevSettingsGet = vi.fn(async () => docSnap(null));
const mockCollection = vi.fn((name: string) =>
  name === 'devSettings' ? { doc: () => ({ get: mockDevSettingsGet }) } : { doc: mockEquipmentDoc },
);
const mockTxGet = vi.fn(async () => docSnap({ briefSourceName: 'Stand mixer' }));
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
  async (fn: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<void>) =>
    fn({ get: mockTxGet, update: mockTxUpdate }),
);

/** Only `exists`, `data()` and `get(field)` are read off any snapshot here. */
function docSnap(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
    get: (field: string) => (data ?? {})[field],
  };
}

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection, runTransaction: mockRunTransaction }),
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

const mockFlow = vi.fn(async () => ({
  imageBase64: Buffer.from('a drawn pictogram').toString('base64'),
}));
vi.mock('../../src/flows/generateEquipmentIcon.js', () => ({
  generateEquipmentIconFlow: (...args: unknown[]) => mockFlow(...(args as [])),
}));

const mockRemoveFlatBackground = vi.fn(async () => Buffer.from('cutout-bytes'));
vi.mock('../../src/imaging/removeFlatBackground.js', () => ({
  removeFlatBackground: (...args: unknown[]) => mockRemoveFlatBackground(...(args as [])),
}));

const mockNormalize = vi.fn(async () => Buffer.from('webp-bytes'));
vi.mock('../../src/imaging/normalizeIconFraming.js', () => ({
  normalizeIconFraming: (...args: unknown[]) => mockNormalize(...(args as [])),
}));

const mockReport = vi.fn(() => undefined);
vi.mock('../../src/observability/reportServerError.js', () => ({
  reportFlowError: (...args: unknown[]) => mockReport(...(args as [])),
  reportServerError: (...args: unknown[]) => mockReport(...(args as [])),
}));

const { drawEquipmentIcon } = await import('../../src/callables/drawEquipmentIcon.js');

const ITEM_ID = 'eq-9b41';
const BRIEF = 'A tilt-head stand mixer, cream enamel, bowl locked in.';
const NOW = 1_700_000_000_000;

function call(data: unknown, auth: unknown = { uid: 'uid-a' }) {
  return (drawEquipmentIcon as unknown as Function)({ auth, data });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('drawEquipmentIcon callable', () => {
  it('rejects unauthenticated callers before touching anything', async () => {
    await expect(
      call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF }, null),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockFlow).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with the exact wire message', async () => {
    await expect(call({ action: 'draw', itemId: ITEM_ID })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Invalid request payload.',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockFlow).not.toHaveBeenCalled();
  });

  it('hide writes the sentinel alone, partially, before the kill switch is even read', async () => {
    const result = await call({ action: 'hide', itemId: ITEM_ID });

    expect(mockEquipmentDoc).toHaveBeenCalledWith(ITEM_ID);
    expect(mockUpdate).toHaveBeenCalledWith({ thumbnail: 'hidden' });
    expect(result).toEqual({ ok: true });
    // Hide is not generation, so the switch is not consulted and nothing else runs.
    expect(mockDevSettingsGet).not.toHaveBeenCalled();
    expect(mockFlow).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('refuses a draw when the kill switch is off, with the exact wire message', async () => {
    mockDevSettingsGet.mockResolvedValueOnce(docSnap({ canonIconGenerationEnabled: false }));

    await expect(call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Icon generation is disabled.',
    });
    expect(mockFlow).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  // The FAIL-OPEN posture: a missing, malformed or unreadable settings doc all
  // leave generation enabled, so the draw proceeds all the way to the upload.
  it.each([
    {
      name: 'a missing devSettings doc',
      prime: () => mockDevSettingsGet.mockResolvedValueOnce(docSnap(null)),
    },
    {
      name: 'an invalid devSettings shape',
      prime: () =>
        mockDevSettingsGet.mockResolvedValueOnce(docSnap({ canonIconGenerationEnabled: 'nope' })),
    },
    {
      name: 'a devSettings read throw',
      prime: () => mockDevSettingsGet.mockRejectedValueOnce(new Error('firestore unavailable')),
    },
  ])('fails open and draws through $name', async ({ prime }) => {
    prime();

    const result = await call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF });

    expect(result).toEqual({ ok: true });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('reports a devSettings read throw as a StorageError while still failing open', async () => {
    // The one stated behavior change of #1006 (Behavior Contract clause 8).
    // Phase 1 pinned the local reader's drift: a read throw warned and failed
    // open but was never reported, unlike the four consolidated sites (#989
    // clause 5). Phase 2 swapped this callable onto the shared reader in
    // triggers/iconWriteTrigger.ts, so the throw is now reported additively —
    // the fail-open draw itself is unchanged.
    const boom = new Error('firestore unavailable');
    mockDevSettingsGet.mockRejectedValueOnce(boom);

    const result = await call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF });

    expect(result).toEqual({ ok: true });
    expect(mockReport).toHaveBeenCalledWith(boom, 'StorageError');
  });

  it.each([
    { name: 'no equipmentIcons doc exists', snap: null },
    { name: 'the doc has no briefSourceName yet', snap: {} },
  ])('refuses a draw when $name, with the exact wire message', async ({ snap }) => {
    mockGet.mockResolvedValueOnce(docSnap(snap));

    await expect(call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'No description to draw from yet.',
    });
    expect(mockFlow).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('draws, strips the background, frames at the canon 108, and uploads immutably', async () => {
    const result = await call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF });

    // The flow is fed the STORED source name (the span label) and the user's brief.
    expect(mockFlow).toHaveBeenCalledWith({ name: 'Stand mixer', brief: BRIEF });
    // Draw path runs background removal (the upload path never does — see
    // setIconUpload.test.ts), then frames at the shared canon value.
    expect(mockRemoveFlatBackground).toHaveBeenCalledWith(Buffer.from('a drawn pictogram'));
    expect(mockNormalize).toHaveBeenCalledWith(Buffer.from('cutout-bytes'), { contentMax: 108 });
    expect(mockFile).toHaveBeenCalledWith(`equipment-icons/${ITEM_ID}.webp`);
    expect(mockSave).toHaveBeenCalledWith(Buffer.from('webp-bytes'), {
      contentType: 'image/webp',
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('stamps icon, brief and sourceName when the name has not moved mid-draw', async () => {
    await call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF });

    expect(mockTxUpdate).toHaveBeenCalledWith(equipmentRef, {
      thumbnail: expect.stringContaining(encodeURIComponent(`equipment-icons/${ITEM_ID}.webp`)),
      iconRequestedAt: NOW,
      subjectBrief: BRIEF,
      sourceName: 'Stand mixer',
    });
    // The download-endpoint URL (governed by storage.rules), never the raw GCS form.
    const stamped = (mockTxUpdate.mock.calls[0]?.[1] as { thumbnail: string }).thumbnail;
    expect(stamped).toMatch(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//);
  });

  it('keeps the picture but leaves the fresher brief alone when a rename landed mid-draw', async () => {
    mockTxGet.mockResolvedValueOnce(docSnap({ briefSourceName: 'Stand mixer (KitchenAid)' }));

    await call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF });

    // Stamp only — no subjectBrief, no sourceName, so the approval gate stays open.
    expect(mockTxUpdate).toHaveBeenCalledWith(equipmentRef, {
      thumbnail: expect.stringContaining(encodeURIComponent(`equipment-icons/${ITEM_ID}.webp`)),
      iconRequestedAt: NOW,
    });
  });

  it('stamps nothing at all when the doc was deleted mid-draw', async () => {
    mockTxGet.mockResolvedValueOnce(docSnap(null));

    const result = await call({ action: 'draw', itemId: ITEM_ID, brief: BRIEF });

    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });
});
