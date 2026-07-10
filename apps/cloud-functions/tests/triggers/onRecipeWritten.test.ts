import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecipeDoc } from '@salt/domain/schemas';

// Unit-level (mock-based, no emulator) coverage of the onRecipeWritten hero-image
// branch (issue #148, Tier-2): the edge-trigger guard, the generate→encode→upload
// →write-back happy path, the kill-switch, and the "manual upload / hidden / bare
// edit re-fire" skips. Mirrors onCanonItemWritten's unit tests.

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => '' }),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGenerateImage = vi.fn(async () => ({ imageBase64: 'QUJD', contentType: 'image/png' }));
vi.mock('../../src/flows/generateRecipeImage.js', () => ({
  generateRecipeImageFlow: mockGenerateImage,
}));

const mockEncode = vi.fn(async () => Buffer.from([1, 2, 3]));
vi.mock('../../src/imaging/encodeHeroImage.js', () => ({ encodeHeroImage: mockEncode }));

// Firestore admin: capture the write-back and answer the devSettings read.
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn().mockResolvedValue({ exists: false }); // devSettings missing → enabled
const DELETE_SENTINEL = Symbol('FieldValue.delete');
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => DELETE_SENTINEL },
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ update: mockUpdate, get: mockGet }) }),
  }),
}));

const mockSave = vi.fn(async () => undefined);
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ name: 'demo-salt.appspot.com', file: () => ({ save: mockSave }) }),
  }),
}));

const mockFlush = vi.fn().mockResolvedValue(undefined);
vi.mock('@salt/observability/server', () => ({
  flushServerObservability: mockFlush,
  // reportServerError.js constructs this at module load — it must exist on the mock.
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

const { onRecipeWritten } = await import('../../src/triggers/onRecipeWritten.js');

function makeRecipe(id: string, overrides: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    id,
    schemaVersion: 1,
    title: 'Roast chicken',
    description: 'A whole roast chicken with lemon and thyme.',
    ingredients: [],
    steps: [],
    metadata: {
      servings: null,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    image: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(id: string, after: RecipeDoc | null, before?: RecipeDoc | null) {
  return {
    params: { id },
    data: {
      before: before
        ? { exists: true, data: () => before }
        : { exists: false, data: () => undefined },
      after: after ? { exists: true, data: () => after } : { exists: false, data: () => undefined },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish clean default implementations each test (clearAllMocks resets
  // call history but not implementations, so a persistent override from one test
  // would otherwise leak into the next).
  mockGenerateImage.mockResolvedValue({ imageBase64: 'QUJD', contentType: 'image/png' });
  mockEncode.mockResolvedValue(Buffer.from([1, 2, 3]));
  mockGet.mockResolvedValue({ exists: false });
});

describe('onRecipeWritten — hero-image branch', () => {
  it('generates on create, encodes, uploads, and writes back an ai image + clears the hint', async () => {
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1')));

    expect(mockGenerateImage).toHaveBeenCalledOnce();
    // Title + description are fed to the flow; no hint present.
    expect(mockGenerateImage).toHaveBeenCalledWith({
      title: 'Roast chicken',
      description: 'A whole roast chicken with lemon and thyme.',
    });
    expect(mockEncode).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledOnce();

    const writeArg = mockUpdate.mock.calls[0]![0];
    expect(writeArg.image.source).toBe('ai');
    expect(writeArg.image.url).toContain('recipe-images%2Fr1.webp');
    expect(writeArg.imageHint).toBe(DELETE_SENTINEL);
    expect(mockFlush).toHaveBeenCalled();
  });

  it('forwards a one-shot hint to the flow', async () => {
    await (onRecipeWritten as Function)(
      makeEvent('r1', makeRecipe('r1', { imageHint: 'on a rustic board' })),
    );
    expect(mockGenerateImage).toHaveBeenCalledWith({
      title: 'Roast chicken',
      description: 'A whole roast chicken with lemon and thyme.',
      hint: 'on a rustic board',
    });
  });

  it('skips when an image already exists (never clobbers a manual upload)', async () => {
    const recipe = makeRecipe('r1', {
      image: { url: 'https://x/upload.webp', source: 'upload' },
    });
    await (onRecipeWritten as Function)(makeEvent('r1', recipe));
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips when the recipe is opted out (imageHidden)', async () => {
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1', { imageHidden: true })));
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it('skips a bare edit re-fire while a generation is in flight (image null both sides, no nonce bump)', async () => {
    const before = makeRecipe('r1', { image: null });
    const after = makeRecipe('r1', { image: null, title: 'Roast chicken (edited)' });
    await (onRecipeWritten as Function)(makeEvent('r1', after, before));
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it('regenerates when the image was just cleared (non-null → null)', async () => {
    const before = makeRecipe('r1', { image: { url: 'https://x/old.webp', source: 'ai' } });
    const after = makeRecipe('r1', { image: null });
    await (onRecipeWritten as Function)(makeEvent('r1', after, before));
    expect(mockGenerateImage).toHaveBeenCalledOnce();
  });

  it('regenerates on a nonce bump even when the image was already null', async () => {
    const before = makeRecipe('r1', { image: null, imageRequestedAt: 1 });
    const after = makeRecipe('r1', { image: null, imageRequestedAt: 2 });
    await (onRecipeWritten as Function)(makeEvent('r1', after, before));
    expect(mockGenerateImage).toHaveBeenCalledOnce();
  });

  it('honours the recipe-image kill-switch', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        canonIconGenerationEnabled: true,
        recipeImageGenerationEnabled: false,
        schemaVersion: 1,
      }),
    });
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1')));
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not write back and still flushes when generation fails', async () => {
    // Reject every attempt (withAiTimeout retries), so the branch catch runs.
    mockGenerateImage.mockRejectedValue(new Error('model exploded'));
    await expect(
      (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1'))),
    ).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockFlush).toHaveBeenCalled();
  });

  it('skips a blank-title draft', async () => {
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1', { title: '   ' })));
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });
});
