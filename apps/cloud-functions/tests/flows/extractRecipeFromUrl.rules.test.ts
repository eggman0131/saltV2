import { describe, it, expect, vi, beforeEach } from 'vitest';

// Issue #785: the URL import is one of three authoring paths that must all be
// prompted by the SAME field-rule module. It is the only one with TWO prompts —
// the JSON-LD path (the page told us where the recipe is; the model converts it)
// and the HTML fallback (the model has to find it first) — and both are asserted
// here, because a hand-rolled twin on either one is the drift this module removed.

const mockGenerate = vi.fn();
const mockJsonLd = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));
vi.mock('@genkit-ai/google-genai', () => ({ googleAI: { model: (name: string) => name } }));
// Bypass the real timer, but keep everything else the module exports (the
// shared budget constant, the stream guard) — a factory that lists only
// `withAiTimeout` goes stale the moment the module grows.
vi.mock('../../src/adapters/withAiTimeout.js', async (importActual) => ({
  ...(await importActual<object>()),
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));
vi.mock('../../src/ai/resolveModel.js', () => ({
  resolveModel: vi.fn(async () => 'gemini-flash-latest'),
}));
vi.mock('@salt/observability/server', () => ({
  setActiveSpanName: vi.fn(),
  // assembleRecipeDraft reports an unjoinable parse result through
  // reportServerError, which builds its adapter at module load (issue #949).
  createServerObservabilityErrorReportingAdapter: () => ({ report: vi.fn() }),
  flushServerObservability: vi.fn(async () => {}),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ set: vi.fn() }) }) }),
}));
vi.mock('firebase-functions', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/adapters/ssrfFetch.js', () => ({
  ssrfGuardedFetch: vi.fn(async () => ({ html: '<html><body>a recipe page</body></html>' })),
  SsrfFetchError: class extends Error {},
}));
vi.mock('../../src/adapters/jsonLdRecipe.js', () => ({ extractRecipeJsonLd: mockJsonLd }));
vi.mock('../../src/flows/parseRecipeIngredients.js', () => ({
  parseRecipeIngredientsFlow: vi.fn(async () => []),
}));
vi.mock('../../src/flows/canonicaliseRecipeIngredients.js', () => ({
  canonicaliseRecipeIngredientsFlow: vi.fn(async () => ({ settled: [] })),
}));

const { extractRecipeFromUrlFlow } = await import('../../src/flows/extractRecipeFromUrl.js');
const { recipeFieldRules } = await import('../../src/flows/recipeFieldRules.js');

const URL = 'https://example.com/carbonara';

const AI_OUTPUT = {
  isRecipe: true,
  title: 'Carbonara',
  description: 'A Roman pasta.',
  ingredientGroups: [
    {
      name: null,
      ingredients: ['200g spaghetti', '2 eggs', '50g pecorino'].map((rawText) => ({
        rawText,
        isOptional: false,
        firstUsedInStepOrdinal: null,
      })),
    },
  ],
  steps: [{ text: 'Boil the pasta.', timerMinutes: null, timerLabel: null, note: null }],
  servings: 2,
  totalTimeMinutes: 20,
  prepTimeMinutes: 5,
  cookTimeMinutes: 15,
  tags: ['pasta'],
  notes: null,
};

const JSON_LD = {
  title: 'Carbonara',
  description: null,
  servings: 2,
  totalTimeMinutes: 20,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  tags: [],
  ingredients: ['200g spaghetti', '2 eggs'],
  steps: ['Boil the pasta.'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
  mockJsonLd.mockReturnValue(null);
});

function systemPromptFrom(): string {
  return (mockGenerate.mock.calls[0]![0] as { system: string }).system;
}

describe('extractRecipeFromUrl — shared field rules (#785)', () => {
  it('interpolates them verbatim on the HTML fallback prompt', async () => {
    await (extractRecipeFromUrlFlow as Function)({ url: URL });

    expect(systemPromptFrom()).toContain(recipeFieldRules({ measures: 'metricate' }));
  });

  it('interpolates the SAME block on the JSON-LD prompt', async () => {
    mockJsonLd.mockReturnValue(JSON_LD);

    await (extractRecipeFromUrlFlow as Function)({ url: URL });

    // The two prompts differ in how the recipe reaches the model, never in the
    // rules it is held to: a recipe imported off a page with schema.org data and
    // one scraped out of its HTML must come back identical in shape and units.
    expect(systemPromptFrom()).toContain(recipeFieldRules({ measures: 'metricate' }));
  });

  it('asks for the rewrite policy on a DOCUMENT source, never the librarian preserve policy', async () => {
    await (extractRecipeFromUrlFlow as Function)({ url: URL });

    // Rewriting someone else's line IS the import.
    const system = systemPromptFrom();
    expect(system).toContain('the ingredient line rewritten in British spelling/terms');
    expect(system).not.toContain('preserve the original wording');
  });

  it('exempts the TIMING from faithfulness, and nothing else (#952)', async () => {
    mockJsonLd.mockReturnValue(JSON_LD);

    await (extractRecipeFromUrlFlow as Function)({ url: URL });

    // The JSON-LD prompt used to name "times" in the same breath as ingredients
    // and steps — "Use ONLY the ingredients, steps, times and servings given" —
    // so an import inherited the food blog's optimistic prep time by explicit
    // instruction, and no amount of defining prep in the shared field rules could
    // reach it.
    const system = systemPromptFrom();
    expect(system).not.toContain('Use ONLY the ingredients, steps, times and servings given');
    expect(system).toContain('Use ONLY the ingredients, steps and servings given');
    expect(system).toContain('The TIMING is the one exception');
    expect(system).toContain('a HINT, not a floor');

    // The narrowing is for the TIMING ONLY. Content stays verbatim.
    expect(system).toContain('Do not invent, add, drop or reorder');
    expect(system).toContain('Keep every ingredient and every instruction');
    expect(system).toContain('this licence covers the timing and nothing else');
  });

  it("labels the page's own times as the page's, not as fields to copy", async () => {
    mockJsonLd.mockReturnValue(JSON_LD);

    await (extractRecipeFromUrlFlow as Function)({ url: URL });

    const prompt = (mockGenerate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('Total time as stated by the page (minutes): 20');
    expect(prompt).not.toContain('Total time (minutes): 20');
  });

  it("bans cups but keeps the source's tsp/tbsp for the parse stage", async () => {
    await (extractRecipeFromUrlFlow as Function)({ url: URL });

    // Converting someone else's units IS the import — but converting the SPOON
    // measures is not, and used to be: the rawText emitted here is the only thing
    // `parseRecipeIngredients` ever sees, so a "1 tsp" metricated at this step is
    // a "(1 tsp)" the cook never gets in the ingredient list.
    const system = systemPromptFrom();
    expect(system).toContain('NEVER cups, sticks, pints, quarts, fluid ounces, ounces or pounds');
    expect(system).toContain('leave a spoon measure EXACTLY as the source wrote it');
    expect(system).not.toContain('tablespoons and teaspoons');
  });
});
