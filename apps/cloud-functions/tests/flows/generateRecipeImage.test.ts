import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));

vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: {
    model: (name: string) => name,
  },
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { generateRecipeImageFlow, RECIPE_IMAGE_STYLE } =
  await import('../../src/flows/generateRecipeImage.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateRecipeImage flow', () => {
  it('returns the model image as base64 + contentType', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    const result = await (generateRecipeImageFlow as Function)({
      title: 'Roast chicken',
      description: 'A whole roast chicken with lemon and thyme.',
    });

    expect(result).toEqual({ imageBase64: 'QUJD', contentType: 'image/png' });
  });

  it('builds a prompt from title + description with the locked house style', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({
      title: 'Roast chicken',
      description: 'A whole roast chicken with lemon and thyme.',
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('Roast chicken');
    expect(prompt).toContain('A whole roast chicken with lemon and thyme.');
    // The full locked style string is embedded verbatim.
    expect(prompt).toContain(RECIPE_IMAGE_STYLE);
    expect(prompt).toContain('photorealistic food photograph');
  });

  it('omits the description clause when the recipe has none', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({ title: 'Roast chicken', description: null });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('the finished dish "Roast chicken"');
    expect(prompt).toContain(RECIPE_IMAGE_STYLE);
  });

  it('appends an optional hint as additive guidance without altering the style', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({
      title: 'Roast chicken',
      description: null,
      hint: 'show it on a rustic board',
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('Additional guidance for this photo: show it on a rustic board');
    expect(prompt).toContain(RECIPE_IMAGE_STYLE);
  });

  it('omits the guidance clause when no hint is given', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({ title: 'Roast chicken', description: null });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).not.toContain('Additional guidance');
  });

  it('weaves recipe tags in as a mood/season hint that must not be rendered', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({
      title: 'Roast chicken',
      description: null,
      tags: ['comfort-food', 'slow-cooker'],
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('This recipe is tagged: comfort-food, slow-cooker');
    // Tags are a cue, never text to render.
    expect(prompt).toContain('do NOT draw, write, label');
    expect(prompt).toContain(RECIPE_IMAGE_STYLE);
  });

  it('appends the hint after the tag clause, still verbatim', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({
      title: 'Roast chicken',
      description: null,
      hint: 'show it on a rustic board',
      tags: ['comfort-food'],
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('This recipe is tagged: comfort-food');
    expect(prompt).toContain('Additional guidance for this photo: show it on a rustic board');
    // The hint is the last clause, after the tag clause.
    expect(prompt.indexOf('This recipe is tagged')).toBeLessThan(
      prompt.indexOf('Additional guidance for this photo'),
    );
  });

  it('adds no tag clause when tags are absent, empty, or whitespace-only', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    for (const tags of [undefined, [], ['', '   ']]) {
      mockGenerate.mockClear();
      await (generateRecipeImageFlow as Function)({
        title: 'Roast chicken',
        description: null,
        ...(tags ? { tags } : {}),
      });
      const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
      expect(prompt).not.toContain('This recipe is tagged');
    }
  });

  it('throws when the model returns no image', async () => {
    mockGenerate.mockResolvedValue({ media: null });

    await expect(
      (generateRecipeImageFlow as Function)({ title: 'Roast chicken', description: null }),
    ).rejects.toThrow(/no image/);
  });
});
