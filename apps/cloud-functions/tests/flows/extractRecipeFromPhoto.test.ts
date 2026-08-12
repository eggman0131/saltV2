import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import a recipe from photographs of a cookbook page (issue #649, Phase 3).
//
// What matters here, and what these tests hold:
//  • the pages go to the model as MEDIA parts — no OCR, no text-flattening stage;
//  • the bytes are request-scoped: nothing is written to Storage, and the draft
//    lands with image: null so onRecipeWritten generates its hero as usual;
//  • the recipe is persisted the moment extraction finishes, needs_approval;
//  • provenance comes only from what the page showed — never invented;
//  • a photo too blurry to read and a page with no recipe are indistinguishable,
//    so they share one failure code.

const mockGenerate = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn(() => ({ set: mockSet }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
const mockLoggerError = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));
vi.mock('@genkit-ai/google-genai', () => ({ googleAI: { model: (name: string) => name } }));
vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));
vi.mock('../../src/ai/resolveModel.js', () => ({
  resolveModel: vi.fn(async () => 'gemini-flash-latest'),
}));
vi.mock('@salt/observability/server', () => ({ setActiveSpanName: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));
vi.mock('firebase-functions', () => ({ logger: { error: mockLoggerError, warn: vi.fn() } }));

// The ingredient sub-flows are not what's under test here.
vi.mock('../../src/flows/parseRecipeIngredients.js', () => ({
  parseRecipeIngredientsFlow: vi.fn(async () => []),
}));
vi.mock('../../src/flows/canonicaliseRecipeIngredients.js', () => ({
  canonicaliseRecipeIngredientsFlow: vi.fn(async () => []),
}));

const { extractRecipeFromPhotoFlow, PhotoImportError } =
  await import('../../src/flows/extractRecipeFromPhoto.js');
const { recipeFieldRules } = await import('../../src/flows/recipeFieldRules.js');

const invoke = (input: unknown) => (extractRecipeFromPhotoFlow as unknown as Function)(input);

const PAGE_ONE = { base64: 'AAAA', contentType: 'image/webp' };
const PAGE_TWO = { base64: 'BBBB', contentType: 'image/jpeg' };

const AI_OUTPUT = {
  isRecipe: true,
  title: 'Ragù alla bolognese',
  description: 'A long-simmered meat sauce.',
  ingredientGroups: [
    {
      name: 'For the sauce',
      ingredients: ['500g beef mince', '100g pancetta', '240ml whole milk'].map((rawText) => ({
        rawText,
        isOptional: false,
        firstUsedInStepOrdinal: null,
      })),
    },
  ],
  steps: [{ text: 'Brown the mince.', timerMinutes: null, timerLabel: null, note: null }],
  servings: 4,
  totalTimeMinutes: null,
  prepTimeMinutes: 20,
  cookTimeMinutes: 180,
  tags: ['italian', 'main'],
  notes: null,
  book: { title: 'The Silver Spoon', author: null, page: 212 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
});

describe('extractRecipeFromPhoto — the pages reach the model as images', () => {
  it('sends each page as a media part, in order, with no OCR stage', async () => {
    await invoke({ images: [PAGE_ONE, PAGE_TWO] });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as { text?: string; media?: unknown }[];
    const media = prompt.filter((p) => 'media' in p).map((p) => p.media);
    expect(media).toEqual([
      { url: 'data:image/webp;base64,AAAA', contentType: 'image/webp' },
      { url: 'data:image/jpeg;base64,BBBB', contentType: 'image/jpeg' },
    ]);
  });

  it('labels the pages so the model reads the spread in order', async () => {
    await invoke({ images: [PAGE_ONE, PAGE_TWO] });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as { text?: string }[];
    const texts = prompt.filter((p) => typeof p.text === 'string').map((p) => p.text!);
    expect(texts[0]).toBe('Page 1 of 2:');
    expect(texts[1]).toBe('Page 2 of 2:');
  });

  it('tells the model the pages are ONE recipe and a different recipe must be ignored', async () => {
    await invoke({ images: [PAGE_ONE, PAGE_TWO] });

    const system = mockGenerate.mock.calls[0]![0].system as string;
    expect(system).toMatch(/SAME recipe/);
    expect(system).toMatch(/IGNORE it entirely/);
  });

  it('carries the shared conversion rules, so metric + British cannot drift from the URL import', async () => {
    await invoke({ images: [PAGE_ONE] });

    const system = mockGenerate.mock.calls[0]![0].system as string;
    expect(system).toContain('Metric only');
    expect(system).toContain('British spelling');
  });

  it('interpolates the shared field rules verbatim, as a DOCUMENT source (#785)', async () => {
    await invoke({ images: [PAGE_ONE] });

    // Whole-block, not a phrase: this is what fails if someone hand-rolls a second
    // field list here, and 'metricate' is what fails if a printed recipe's cups
    // ever stop being converted. A cookbook page is someone else's units — the
    // conversion is the entire point of the import.
    const system = mockGenerate.mock.calls[0]![0].system as string;
    expect(system).toContain(recipeFieldRules({ measures: 'metricate' }));
  });

  it('runs at temperature 0 — accuracy over creativity', async () => {
    await invoke({ images: [PAGE_ONE] });
    expect(mockGenerate.mock.calls[0]![0].config).toEqual({ temperature: 0 });
  });
});

describe('extractRecipeFromPhoto — the draft it assembles', () => {
  it('persists the recipe immediately, flagged needs_approval', async () => {
    const recipe = await invoke({ images: [PAGE_ONE] });

    expect(mockCollection).toHaveBeenCalledWith('recipes');
    expect(mockDoc).toHaveBeenCalledWith(recipe.id);
    const written = mockSet.mock.calls[0]![0];
    expect(written.needs_approval).toBe(true);
    expect(written.title).toBe('Ragù alla bolognese');
    expect(recipe.needs_approval).toBe(true);
  });

  it("stamps source.type='book' with the provenance the page actually showed", async () => {
    const recipe = await invoke({ images: [PAGE_ONE] });

    // author was not legible → omitted rather than recorded as null/blank.
    expect(recipe.source).toEqual({
      type: 'book',
      book: { title: 'The Silver Spoon', page: 212 },
    });
  });

  it('omits book entirely when nothing about the book was legible — never invents one', async () => {
    mockGenerate.mockResolvedValue({ output: { ...AI_OUTPUT, book: null } });

    const recipe = await invoke({ images: [PAGE_ONE] });

    expect(recipe.source).toEqual({ type: 'book' });
  });

  it('derives a total time from prep + cook, as a printed page rarely states one', async () => {
    const recipe = await invoke({ images: [PAGE_ONE] });
    expect(recipe.metadata.totalTimeMinutes).toBe(200);
  });

  it('keeps the book’s own ingredient grouping', async () => {
    const recipe = await invoke({ images: [PAGE_ONE] });
    expect(recipe.ingredients[0].name).toBe('For the sauce');
  });

  it('leaves image null so onRecipeWritten generates the hero, exactly as for a URL import', async () => {
    const recipe = await invoke({ images: [PAGE_ONE] });
    // The page photographs are request-scoped input: read and discarded. They
    // never become the hero and never enter the orphan sweep (#620).
    expect(recipe.image).toBeNull();
  });

  it('still returns the recipe when the write fails, and logs it', async () => {
    mockSet.mockRejectedValue(new Error('firestore unavailable'));

    const recipe = await invoke({ images: [PAGE_ONE] });

    expect(recipe.title).toBe('Ragù alla bolognese');
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('failed to persist'),
      expect.objectContaining({ recipeId: recipe.id }),
    );
  });
});

describe('extractRecipeFromPhoto — failures', () => {
  it('refuses a page with no recipe on it', async () => {
    mockGenerate.mockResolvedValue({
      output: { ...AI_OUTPUT, isRecipe: false, ingredientGroups: [], steps: [] },
    });

    await expect(invoke({ images: [PAGE_ONE] })).rejects.toMatchObject({
      code: 'unreadable-photos',
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('refuses an unreadable photo through the SAME code — the server cannot tell them apart', async () => {
    // A blurry page produces exactly the shape a non-recipe page does: the model
    // has no channel to say "I could not see it" other than isRecipe=false.
    mockGenerate.mockResolvedValue({
      output: { ...AI_OUTPUT, isRecipe: false, title: '', ingredientGroups: [], steps: [] },
    });

    await expect(invoke({ images: [PAGE_ONE] })).rejects.toMatchObject({
      code: 'unreadable-photos',
    });
  });

  it('refuses a too-thin extraction rather than assembling a stub draft', async () => {
    mockGenerate.mockResolvedValue({
      output: {
        ...AI_OUTPUT,
        ingredientGroups: [
          {
            name: null,
            ingredients: [{ rawText: 'salt', isOptional: false, firstUsedInStepOrdinal: null }],
          },
        ],
      },
    });

    await expect(invoke({ images: [PAGE_ONE] })).rejects.toMatchObject({
      code: 'unreadable-photos',
    });
  });

  it('maps a model failure to import-failed, not to a claim about the photos', async () => {
    mockGenerate.mockRejectedValue(new Error('upstream 503'));

    const err = await invoke({ images: [PAGE_ONE] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoImportError);
    expect((err as { code: string }).code).toBe('import-failed');
  });

  it('maps a malformed structured response to import-failed', async () => {
    mockGenerate.mockResolvedValue({ output: { nonsense: true } });

    await expect(invoke({ images: [PAGE_ONE] })).rejects.toMatchObject({ code: 'import-failed' });
  });
});
