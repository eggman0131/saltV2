import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));

vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: { model: (name: string) => name },
}));

// Stub withAiTimeout to call op() directly — timeout/retry logic is tested elsewhere.
vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));

// resolveModel reads Firestore in production; pin it in the unit test.
vi.mock('../../src/ai/resolveModel.js', () => ({
  resolveModel: vi.fn().mockResolvedValue('gemini-flash-latest'),
}));

const { categoriseRecipeFlow } = await import('../../src/flows/categoriseRecipe.js');

beforeEach(() => {
  vi.clearAllMocks();
});

const input = {
  title: 'Lasagne al forno',
  description: 'A rich baked pasta.',
  ingredients: ['500g beef mince', '2 cloves garlic'],
  steps: ['Brown the mince.', 'Layer and bake.'],
};

describe('categoriseRecipe — tag normalisation', () => {
  it('lowercases, kebab-cases, comma-splits and dedupes the model tags', async () => {
    mockGenerate.mockResolvedValue({
      output: { tags: ['Italian', 'Comfort Food, Main', 'MAIN', 'italian', ''] },
    });

    const result = await (categoriseRecipeFlow as Function)(input);

    expect(result.tags).toEqual(['italian', 'comfort-food', 'main']);
  });

  it('returns an empty array when the model emits no tags', async () => {
    mockGenerate.mockResolvedValue({ output: { tags: [] } });

    const result = await (categoriseRecipeFlow as Function)(input);

    expect(result.tags).toEqual([]);
  });

  it('throws when the model output is not the expected shape', async () => {
    mockGenerate.mockResolvedValue({ output: { notTags: true } });

    await expect((categoriseRecipeFlow as Function)(input)).rejects.toThrow(/invalid output/);
  });
});

describe('categoriseRecipe — prompt construction', () => {
  it('feeds the recipe content into the prompt as context', async () => {
    mockGenerate.mockResolvedValue({ output: { tags: [] } });

    await (categoriseRecipeFlow as Function)(input);

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('Title: Lasagne al forno');
    expect(prompt).toContain('A rich baked pasta.');
    expect(prompt).toContain('500g beef mince');
    expect(prompt).toContain('Brown the mince.');
  });

  it('omits absent optional context (null description, no steps) from the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: { tags: [] } });

    await (categoriseRecipeFlow as Function)({
      title: 'Quick salad',
      description: null,
      ingredients: ['1 cucumber'],
      steps: [],
    });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('Title: Quick salad');
    expect(prompt).not.toContain('Description:');
    expect(prompt).not.toContain('Method:');
  });

  it('carries the shared category rules — including the ingredient ban — in the system prompt', async () => {
    mockGenerate.mockResolvedValue({ output: { tags: [] } });

    await (categoriseRecipeFlow as Function)(input);

    const { system } = mockGenerate.mock.calls[0]![0];
    expect(system).toContain('search and filtering');
    expect(system).toContain('NEVER use an ingredient as a tag');
    expect(system).toContain('cuisine');
  });

  it('passes temperature 0 and an output schema to generate', async () => {
    mockGenerate.mockResolvedValue({ output: { tags: [] } });

    await (categoriseRecipeFlow as Function)(input);

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.config).toEqual({ temperature: 0 });
    expect(opts.output?.schema).toBeDefined();
  });
});
