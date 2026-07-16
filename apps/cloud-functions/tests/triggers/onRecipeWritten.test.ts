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

const mockDescribeScene = vi.fn(async () => ({ brief: 'A blistered, golden-topped bake.' }));
vi.mock('../../src/flows/describeRecipeScene.js', () => ({
  describeRecipeSceneFlow: mockDescribeScene,
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
  mockDescribeScene.mockResolvedValue({ brief: 'A blistered, golden-topped bake.' });
  mockEncode.mockResolvedValue(Buffer.from([1, 2, 3]));
  mockGet.mockResolvedValue({ exists: false });
});

describe('onRecipeWritten — hero-image branch', () => {
  it('generates on create, encodes, uploads, and writes back an ai image + clears the hint', async () => {
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1')));

    expect(mockGenerateImage).toHaveBeenCalledOnce();
    // Title + description + the recipe's tags + the freshly-authored scene brief
    // are fed to the flow; no hint present.
    expect(mockGenerateImage).toHaveBeenCalledWith({
      title: 'Roast chicken',
      description: 'A whole roast chicken with lemon and thyme.',
      tags: [],
      sceneBrief: 'A blistered, golden-topped bake.',
    });
    expect(mockEncode).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledOnce();

    const writeArg = mockUpdate.mock.calls[0]![0];
    expect(writeArg.image.source).toBe('ai');
    expect(writeArg.image.url).toContain('recipe-images%2Fr1.webp');
    expect(writeArg.imageHint).toBe(DELETE_SENTINEL);
    // The brief is persisted in the SAME write as the image it produced.
    expect(writeArg.imageBrief).toBe('A blistered, golden-topped bake.');
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
      tags: [],
      sceneBrief: 'A blistered, golden-topped bake.',
    });
  });

  it("forwards the recipe's tags to the flow as a dish-type signal", async () => {
    await (onRecipeWritten as Function)(
      makeEvent(
        'r1',
        makeRecipe('r1', {
          metadata: {
            servings: null,
            totalTimeMinutes: null,
            prepTimeMinutes: null,
            cookTimeMinutes: null,
            tags: ['comfort-food', 'slow-cooker'],
          },
        }),
      ),
    );
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['comfort-food', 'slow-cooker'] }),
    );
  });

  it('skips when an image already exists (never clobbers a manual upload)', async () => {
    const recipe = makeRecipe('r1', {
      image: { url: 'https://x/upload.webp', source: 'upload' },
    });
    await (onRecipeWritten as Function)(makeEvent('r1', recipe));
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('generates regardless of the retired imageHidden field (now inert)', async () => {
    // imageHidden was retired (Phase 1): the trigger no longer honors it, so a
    // create with a null image still generates even when the field is set.
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1', { imageHidden: true })));
    expect(mockGenerateImage).toHaveBeenCalledOnce();
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

describe('onRecipeWritten — scene brief', () => {
  it('authors a brief from the WHOLE recipe — ingredients and steps, not just the title', async () => {
    await (onRecipeWritten as Function)(
      makeEvent(
        'r1',
        makeRecipe('r1', {
          ingredients: [
            {
              id: 'g1',
              name: null,
              items: [
                {
                  id: 'i1',
                  rawText: 'a handful of basil',
                  parsed: null,
                  canonId: null,
                  matchState: 'pending',
                  isOptional: false,
                  firstUsedInStepId: null,
                },
              ],
            },
          ],
          steps: [
            {
              id: 's1',
              text: 'Grill until the top is blistered and golden.',
              timer: null,
              note: null,
            },
          ],
        }),
      ),
    );

    // The ingredient groups are flattened to their display lines and the steps to
    // their text — this is the only path by which a garnish or a finishing cue that
    // appears nowhere in the title/description reaches the hero.
    expect(mockDescribeScene).toHaveBeenCalledWith({
      title: 'Roast chicken',
      description: 'A whole roast chicken with lemon and thyme.',
      ingredients: ['a handful of basil'],
      steps: ['Grill until the top is blistered and golden.'],
    });
  });

  it('uses a brief already on the doc verbatim, without authoring a new one', async () => {
    await (onRecipeWritten as Function)(
      makeEvent('r1', makeRecipe('r1', { imageBrief: 'A human wrote this brief.' })),
    );

    // Present on the doc → used as-is. The trigger neither knows nor cares whether a
    // human or the model wrote it.
    expect(mockDescribeScene).not.toHaveBeenCalled();
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ sceneBrief: 'A human wrote this brief.' }),
    );
    expect(mockUpdate.mock.calls[0]![0].imageBrief).toBe('A human wrote this brief.');
  });

  it('authors one when the doc brief is blank', async () => {
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1', { imageBrief: '   ' })));
    expect(mockDescribeScene).toHaveBeenCalledOnce();
  });

  it('still generates the image when the brief step fails (degrades, never throws)', async () => {
    mockDescribeScene.mockRejectedValue(new Error('brief model exploded'));

    await expect(
      (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1'))),
    ).resolves.toBeUndefined();

    // Rule 10: a brief is an improvement to the prompt, never a precondition. The
    // hero is generated anyway, with NO sceneBrief — so the flow uses its
    // dish-reading fallback, i.e. exactly the pre-brief behaviour.
    expect(mockGenerateImage).toHaveBeenCalledOnce();
    expect(mockGenerateImage.mock.calls[0]![0]).not.toHaveProperty('sceneBrief');
    const writeArg = mockUpdate.mock.calls[0]![0];
    expect(writeArg.image.source).toBe('ai');
    expect(writeArg).not.toHaveProperty('imageBrief');
  });

  it('falls back when the brief flow returns an empty brief', async () => {
    mockDescribeScene.mockResolvedValue({ brief: '   ' });
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1')));
    expect(mockGenerateImage).toHaveBeenCalledOnce();
    expect(mockGenerateImage.mock.calls[0]![0]).not.toHaveProperty('sceneBrief');
  });

  it('never pays for a brief when a guard skips generation', async () => {
    // The brief call sits AFTER every cheap guard, so a disabled environment, an
    // existing image, or a blank draft costs nothing.
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        canonIconGenerationEnabled: true,
        recipeImageGenerationEnabled: false,
        schemaVersion: 1,
      }),
    });
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1')));
    expect(mockDescribeScene).not.toHaveBeenCalled();

    mockGet.mockResolvedValue({ exists: false });
    await (onRecipeWritten as Function)(makeEvent('r1', makeRecipe('r1', { title: '  ' })));
    expect(mockDescribeScene).not.toHaveBeenCalled();

    await (onRecipeWritten as Function)(
      makeEvent('r1', makeRecipe('r1', { image: { url: 'https://x/u.webp', source: 'upload' } })),
    );
    expect(mockDescribeScene).not.toHaveBeenCalled();
  });
});
