import { describe, it, expect, vi, beforeEach } from 'vitest';

// describeRecipeScene: the cheap text step that reads the WHOLE recipe and writes
// the art-direction brief the hero prompt is built from. Mirrors the
// categoriseRecipe flow tests (same input shape, same mocking seam).

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

vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));

const mockResolveModel = vi.fn(async () => 'gemini-flash-latest');
vi.mock('../../src/ai/resolveModel.js', () => ({ resolveModel: mockResolveModel }));

const { describeRecipeSceneFlow } = await import('../../src/flows/describeRecipeScene.js');

const RECIPE = {
  title: 'Melanzane alla parmigiana',
  description: 'A baked aubergine dish.',
  ingredients: ['2 aubergines, sliced', 'a handful of basil', '125g mozzarella'],
  steps: ['Layer the aubergine with sauce.', 'Grill until the top is blistered and golden.'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveModel.mockResolvedValue('gemini-flash-latest');
});

describe('describeRecipeScene flow', () => {
  it('returns the brief the model wrote', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'A blistered, golden-topped bake.' } });

    const result = await (describeRecipeSceneFlow as Function)(RECIPE);

    expect(result).toEqual({ brief: 'A blistered, golden-topped bake.' });
  });

  it('trims the brief', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: '  A blistered bake.\n' } });
    const result = await (describeRecipeSceneFlow as Function)(RECIPE);
    expect(result).toEqual({ brief: 'A blistered bake.' });
  });

  it('feeds the model the WHOLE recipe — every ingredient and every step', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });

    await (describeRecipeSceneFlow as Function)(RECIPE);

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('Melanzane alla parmigiana');
    expect(prompt).toContain('A baked aubergine dish.');
    // The point of the whole flow: details that exist ONLY in the ingredients or
    // the method reach the model.
    expect(prompt).toContain('a handful of basil');
    expect(prompt).toContain('Grill until the top is blistered and golden.');
  });

  it('omits the description, ingredient and method blocks when empty', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });

    await (describeRecipeSceneFlow as Function)({
      title: 'Toast',
      description: null,
      ingredients: [],
      steps: [],
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toBe('Title: Toast');
  });

  it('asks for the dish-specific half only, never the house style or prohibitions', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });

    await (describeRecipeSceneFlow as Function)(RECIPE);

    const system = mockGenerate.mock.calls[0]![0].system as string;
    // It directs the dish…
    expect(system).toContain('plated');
    expect(system).toContain('garnish');
    expect(system).toContain('mood, season and cuisine');
    // …and explicitly stays off the anchors' territory. A brief that authored
    // lighting or prohibitions would be a per-recipe vote on the house style.
    expect(system).toContain('Do NOT write about photographic style, lighting');
    // And it is a paragraph, not an essay.
    expect(system).toContain('ONE paragraph');
  });

  it('resolves the fast model with its own flow id (per-flow overrides work)', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });
    await (describeRecipeSceneFlow as Function)(RECIPE);
    expect(mockResolveModel).toHaveBeenCalledWith('fast', 'describeRecipeScene');
  });

  it('throws when the model returns an invalid output (AI output is a trust boundary)', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 42 } });

    await expect((describeRecipeSceneFlow as Function)(RECIPE)).rejects.toThrow(/invalid output/);
  });

  it('throws when the model returns nothing', async () => {
    mockGenerate.mockResolvedValue({ output: null });

    await expect((describeRecipeSceneFlow as Function)(RECIPE)).rejects.toThrow(/invalid output/);
  });
});
