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

const {
  generateRecipeImageFlow,
  RECIPE_IMAGE_STYLE_ANCHORS,
  RECIPE_IMAGE_DISH_READING_FALLBACK,
  OUTING_IMAGE_STYLE_ANCHORS,
  OUTING_SCENE_FALLBACK,
  COCKTAIL_IMAGE_STYLE_ANCHORS,
  COCKTAIL_SCENE_FALLBACK,
  GENERATE_RECIPE_IMAGE_KINDS,
} = await import('../../src/flows/generateRecipeImage.js');

const { RecipeKindSchema } = await import('@salt/domain/schemas');

const IMAGE_OK = { media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' } };

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

// ─── Entry kinds (issue #637) ────────────────────────────────────────────────
// The `recipes` collection also holds outings — a takeaway, a picnic, a meal out.
// Painting one with the recipe anchors produces a home-plated dish that never
// existed, so `kind` selects a sibling opener, fallback and anchor set. 'recipe' is
// the default arm everywhere, so absent and unrecognised kinds are unchanged.
describe('generateRecipeImage flow — entry kinds', () => {
  beforeEach(() => {
    mockGenerate.mockResolvedValue(IMAGE_OK);
  });

  async function promptFor(input: Record<string, unknown>): Promise<string> {
    mockGenerate.mockClear();
    await (generateRecipeImageFlow as Function)(input);
    return mockGenerate.mock.calls[0]![0].prompt as string;
  }

  it('pins the locally-declared kind literals against the domain enum', () => {
    // These literals CANNOT be imported: genkit bundles its own zod instance, so a
    // schema built from plain `zod` is not interchangeable with genkit's `z`. This
    // assertion is what stops the hand-copied list from drifting — add a kind to
    // RecipeKindSchema and this fails until the flow's list follows.
    expect([...GENERATE_RECIPE_IMAGE_KINDS]).toEqual(RecipeKindSchema.options);
  });

  it('produces a byte-identical prompt when kind is absent or "recipe"', async () => {
    const input = {
      title: 'Roast chicken',
      description: 'A whole roast chicken with lemon and thyme.',
      tags: ['comfort-food'],
      hint: 'show it on a rustic board',
    };

    const absent = await promptFor(input);
    const explicit = await promptFor({ ...input, kind: 'recipe' });

    // Every kind now has art direction of its own, so 'recipe' is the default arm
    // for absence only — a doc written before #637, or a caller that sends no kind.
    expect(explicit).toBe(absent);
  });

  it('paints an outing as food that ARRIVES — outing anchors, never the recipe ones', async () => {
    const prompt = await promptFor({
      title: 'Friday night curry',
      description: null,
      kind: 'outing',
    });

    expect(prompt).toContain(OUTING_IMAGE_STYLE_ANCHORS);
    expect(prompt).toContain(OUTING_SCENE_FALLBACK);
    // The recipe house style must not leak in — a plated-dish anchor set is exactly
    // the picture an outing is not.
    expect(prompt).not.toContain(RECIPE_IMAGE_STYLE_ANCHORS);
    expect(prompt).not.toContain(RECIPE_IMAGE_DISH_READING_FALLBACK);
    // …nor the "finished dish" opener.
    expect(prompt).not.toContain('the finished dish');
    expect(prompt).toContain('as it actually arrives');
  });

  it('keeps the outing anchors LAST on the brief path', async () => {
    const prompt = await promptFor({
      title: 'Friday night curry',
      description: 'From the place on the corner.',
      kind: 'outing',
      sceneBrief: 'Foil trays opened out on a coffee table, naan torn in half.',
      tags: ['takeaway'],
      hint: 'lots of little tubs',
    });

    // The brief REPLACES the fallback, exactly as on the recipe path…
    expect(prompt).toContain('Foil trays opened out on a coffee table');
    expect(prompt).not.toContain(OUTING_SCENE_FALLBACK);
    // …and everything authored still sits before the anchors, which end the prompt.
    // This ordering matters MORE here: with no method to read, a hand-edited brief
    // is the primary path for an outing, so it is the likeliest thing to try to
    // talk the model out of "no people, no logos".
    expect(prompt.indexOf('Foil trays opened out')).toBeLessThan(
      prompt.indexOf(OUTING_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.indexOf('This recipe is tagged')).toBeLessThan(
      prompt.indexOf(OUTING_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.indexOf('Additional guidance for this photo')).toBeLessThan(
      prompt.indexOf(OUTING_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.endsWith(OUTING_IMAGE_STYLE_ANCHORS)).toBe(true);
  });

  it('keeps the outing anchors LAST on the fallback path too (no brief)', async () => {
    const prompt = await promptFor({
      title: 'Friday night curry',
      description: null,
      kind: 'outing',
      hint: 'lots of little tubs',
    });
    expect(prompt.endsWith(OUTING_IMAGE_STYLE_ANCHORS)).toBe(true);
  });

  it('keeps the outing anchor wording verbatim', () => {
    // Canary, mirroring the recipe anchors': these are the outing house style and
    // the prohibitions. Reword deliberately, then update this test.
    expect(OUTING_IMAGE_STYLE_ANCHORS).toContain('IN THE VESSEL IT ARRIVED IN');
    expect(OUTING_IMAGE_STYLE_ANCHORS).toContain('Do NOT plate it up onto home crockery');
    expect(OUTING_IMAGE_STYLE_ANCHORS).toContain('photorealistic photograph');
    expect(OUTING_IMAGE_STYLE_ANCHORS).toContain('shallow depth of field');
    expect(OUTING_IMAGE_STYLE_ANCHORS).toContain(
      'Absolutely no text, no captions, no watermark, no logos, no branding, no hands, no people.',
    );
    // The fallback owns the occasion-reading guess and must not smuggle anchors in.
    expect(OUTING_SCENE_FALLBACK).not.toContain('no hands, no people');
  });

  // ─── Cocktails (Phase 5) ───────────────────────────────────────────────────
  // A cocktail keeps the ingredients and the method, so unlike an outing it is a
  // recipe in every way the editor cares about. What it has no version of is a
  // PLATE — so the recipe anchors, which put food "generously plated on rustic
  // ceramic", paint a drink that was served as dinner.

  it('paints a cocktail as a glass on a bar — cocktail anchors, never the recipe ones', async () => {
    const prompt = await promptFor({
      title: 'Negroni',
      description: null,
      kind: 'cocktail',
    });

    expect(prompt).toContain(COCKTAIL_IMAGE_STYLE_ANCHORS);
    expect(prompt).toContain(COCKTAIL_SCENE_FALLBACK);
    // The plated-dish house style must not leak in — a Negroni on rustic ceramic is
    // exactly the picture this kind exists to avoid.
    expect(prompt).not.toContain(RECIPE_IMAGE_STYLE_ANCHORS);
    expect(prompt).not.toContain(RECIPE_IMAGE_DISH_READING_FALLBACK);
    // …nor the "finished dish" opener, nor the outing's arrives-in-a-box direction.
    expect(prompt).not.toContain('the finished dish');
    expect(prompt).not.toContain(OUTING_IMAGE_STYLE_ANCHORS);
    expect(prompt).toContain('the finished drink in its glass');
  });

  it('keeps the cocktail anchors LAST on the brief path', async () => {
    const prompt = await promptFor({
      title: 'Negroni',
      description: 'Equal parts, stirred, big cube.',
      kind: 'cocktail',
      sceneBrief: 'A deep red Negroni over a clear block of ice, orange twist across the rim.',
      tags: ['aperitivo'],
      hint: 'make it late evening',
    });

    // The brief REPLACES the fallback, exactly as on the other two paths…
    expect(prompt).toContain('A deep red Negroni over a clear block of ice');
    expect(prompt).not.toContain(COCKTAIL_SCENE_FALLBACK);
    // …and everything authored still sits before the anchors, which end the prompt.
    expect(prompt.indexOf('A deep red Negroni')).toBeLessThan(
      prompt.indexOf(COCKTAIL_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.indexOf('This recipe is tagged')).toBeLessThan(
      prompt.indexOf(COCKTAIL_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.indexOf('Additional guidance for this photo')).toBeLessThan(
      prompt.indexOf(COCKTAIL_IMAGE_STYLE_ANCHORS),
    );
    expect(prompt.endsWith(COCKTAIL_IMAGE_STYLE_ANCHORS)).toBe(true);
  });

  it('keeps the cocktail anchors LAST on the fallback path too (no brief)', async () => {
    const prompt = await promptFor({
      title: 'Negroni',
      description: null,
      kind: 'cocktail',
      hint: 'make it late evening',
    });
    expect(prompt.endsWith(COCKTAIL_IMAGE_STYLE_ANCHORS)).toBe(true);
  });

  it('keeps the cocktail anchor wording verbatim', () => {
    // Canary, mirroring the other two: the cocktail house style and the
    // prohibitions. Reword deliberately, then update this test.
    expect(COCKTAIL_IMAGE_STYLE_ANCHORS).toContain('CORRECT GLASSWARE');
    expect(COCKTAIL_IMAGE_STYLE_ANCHORS).toContain('Do NOT plate it as food');
    expect(COCKTAIL_IMAGE_STYLE_ANCHORS).toContain('photorealistic photograph');
    expect(COCKTAIL_IMAGE_STYLE_ANCHORS).toContain('shallow depth of field');
    // "no bottle labels" is the cocktail-specific addition: a bar back is where the
    // model most wants to invent a spirits brand, and a legible label is a logo.
    expect(COCKTAIL_IMAGE_STYLE_ANCHORS).toContain(
      'Absolutely no text, no captions, no watermark, no logos, no branding, no bottle labels, no hands, no people.',
    );
    // The fallback owns the serve-reading guess and must not smuggle anchors in.
    expect(COCKTAIL_SCENE_FALLBACK).not.toContain('no hands, no people');
  });

  it('gives each kind its own anchors — no two share a set', () => {
    const sets = [
      RECIPE_IMAGE_STYLE_ANCHORS,
      OUTING_IMAGE_STYLE_ANCHORS,
      COCKTAIL_IMAGE_STYLE_ANCHORS,
    ];
    expect(new Set(sets).size).toBe(GENERATE_RECIPE_IMAGE_KINDS.length);
  });
});
