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

const { generateRecipeImageFlow, RECIPE_IMAGE_STYLE_ANCHORS, RECIPE_IMAGE_DISH_READING_FALLBACK } =
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
    // The locked anchors are embedded verbatim.
    expect(prompt).toContain(RECIPE_IMAGE_STYLE_ANCHORS);
    expect(prompt).toContain('photorealistic food photograph');
  });

  it('omits the description clause when the recipe has none', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({ title: 'Roast chicken', description: null });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('the finished dish "Roast chicken"');
    expect(prompt).toContain(RECIPE_IMAGE_STYLE_ANCHORS);
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
    expect(prompt).toContain(RECIPE_IMAGE_STYLE_ANCHORS);
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
    expect(prompt).toContain(RECIPE_IMAGE_STYLE_ANCHORS);
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

  // ─── Scene brief (art direction authored from the whole recipe) ─────────────

  it('uses the scene brief in place of the dish-reading fallback', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({
      title: 'Melanzane',
      description: null,
      sceneBrief: 'A blistered, golden-topped bake scattered with torn basil.',
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('A blistered, golden-topped bake scattered with torn basil.');
    // The brief REPLACES the guess — the model is not asked to work the dish out
    // itself when it has already been told what the dish looks like.
    expect(prompt).not.toContain(RECIPE_IMAGE_DISH_READING_FALLBACK);
    // …but the anchors still hold.
    expect(prompt).toContain(RECIPE_IMAGE_STYLE_ANCHORS);
  });

  it('falls back to the dish-reading clause when no brief is available', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({ title: 'Roast chicken', description: null });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain(RECIPE_IMAGE_DISH_READING_FALLBACK);
    expect(prompt).toContain(RECIPE_IMAGE_STYLE_ANCHORS);
  });

  it('falls back when the brief is empty or whitespace-only (a failed brief step)', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    for (const sceneBrief of ['', '   ']) {
      mockGenerate.mockClear();
      await (generateRecipeImageFlow as Function)({
        title: 'Roast chicken',
        description: null,
        sceneBrief,
      });
      const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
      expect(prompt).toContain(RECIPE_IMAGE_DISH_READING_FALLBACK);
    }
  });

  it('reproduces the pre-brief prompt exactly on the plain fallback path', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({ title: 'Roast chicken', description: null });

    // The two constants were split out of ONE fused literal; with no brief, no tags
    // and no hint, `fallback + ' ' + anchors` must still recompose to it byte for
    // byte, so an existing recipe's hero is unchanged.
    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toBe(
      `A beautiful, appetising photograph of the finished dish "Roast chicken". ` +
        `${RECIPE_IMAGE_DISH_READING_FALLBACK} ${RECIPE_IMAGE_STYLE_ANCHORS}`,
    );
  });

  it('keeps the anchor wording verbatim', () => {
    // The anchors are the cross-recipe house style and the prohibitions. This is a
    // canary on the exact wording — if a refactor paraphrases them, every hero
    // silently drifts. Reword deliberately, then update this test.
    expect(RECIPE_IMAGE_STYLE_ANCHORS).toContain('photorealistic food photograph');
    expect(RECIPE_IMAGE_STYLE_ANCHORS).toContain('soft natural window light');
    expect(RECIPE_IMAGE_STYLE_ANCHORS).toContain('shallow depth of field');
    expect(RECIPE_IMAGE_STYLE_ANCHORS).toContain('rustic ceramic or worn crockery');
    expect(RECIPE_IMAGE_STYLE_ANCHORS).toContain(
      'Absolutely no text, no captions, no watermark, no logos, no hands, no people.',
    );
    // The fallback owns the dish-reading guess and must not smuggle anchors in.
    expect(RECIPE_IMAGE_DISH_READING_FALLBACK).not.toContain('no hands, no people');
  });

  it('puts the anchors LAST — after the brief, the tags and the hint', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({
      title: 'Melanzane',
      description: 'Baked aubergine.',
      sceneBrief: 'A blistered, golden-topped bake scattered with torn basil.',
      tags: ['comfort-food'],
      hint: 'show it on a rustic board',
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    // Everything authored — the brief, the tags, the user hint — sits BEFORE the
    // anchors, and the anchors end the prompt. This ordering is what stops an
    // (eventually editable) brief from overriding "no text, no people".
    expect(prompt.indexOf('torn basil')).toBeLessThan(prompt.indexOf(RECIPE_IMAGE_STYLE_ANCHORS));
    expect(prompt.indexOf('This recipe is tagged')).toBeLessThan(
      prompt.indexOf(RECIPE_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.indexOf('Additional guidance for this photo')).toBeLessThan(
      prompt.indexOf(RECIPE_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.endsWith(RECIPE_IMAGE_STYLE_ANCHORS)).toBe(true);
  });

  it('puts the anchors last on the fallback path too (no brief)', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateRecipeImageFlow as Function)({
      title: 'Roast chicken',
      description: null,
      hint: 'show it on a rustic board',
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt.endsWith(RECIPE_IMAGE_STYLE_ANCHORS)).toBe(true);
  });

  it('throws when the model returns no image', async () => {
    mockGenerate.mockResolvedValue({ media: null });

    await expect(
      (generateRecipeImageFlow as Function)({ title: 'Roast chicken', description: null }),
    ).rejects.toThrow(/no image/);
  });
});
