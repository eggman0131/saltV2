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
vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));
vi.mock('../../src/ai/resolveModel.js', () => ({
  resolveModel: vi.fn(async () => 'gemini-flash-latest'),
}));
vi.mock('@salt/observability/server', () => ({ setActiveSpanName: vi.fn() }));
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

  it('asks for metric on a DOCUMENT source, never the librarian preserve policy', async () => {
    await (extractRecipeFromUrlFlow as Function)({ url: URL });

    // Converting someone else's units IS the import. If this ever flips to the
    // conversation policy, imports silently start arriving in cups.
    const system = systemPromptFrom();
    expect(system).toContain('Metric only: convert all quantities to metric');
    expect(system).not.toContain('preserve the original wording');
  });
});
