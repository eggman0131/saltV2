/**
 * Characterisation net for the kitchen-tool icon flow (issue #882).
 *
 * Mirrors tests/flows/generateCanonIcon.test.ts, the family this one descends
 * from. Written before #989 Phase 4 collapses the three flow bodies onto one
 * factory, so it is what proves the collapse changed nothing.
 *
 * THE PROMPT IS PINNED BY EXACT EQUALITY, not by `toContain` (issue #989,
 * Phase 3). docs/canon-icons.md:351 records that this wording is reproduced
 * verbatim and that paraphrasing drifts the house style — so the assertion has
 * to be able to see a paraphrase, and `toContain` cannot: it goes green over a
 * reordered clause, a dropped sentence, or a whole new one appended.
 *
 * That makes these two literals a second copy of locked wording, which is
 * normally the thing this repo forbids (see tests/imagePromptSingleSource.test.ts).
 * It is deliberate here and it is the point: a copy that must be updated in the
 * same commit as the source is a CHANGE DETECTOR, not a second source of truth.
 * Nothing reads these strings but this file, and #990 — which realigns the style
 * anchors — is meant to turn them red, so its diff can be reviewed on before/after
 * imagery rather than on argument. Update them with the change; never around it.
 */
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

// Avoid reading the real seed asset; these tests only care that a reference
// media part is passed through.
vi.mock('../../src/flows/assets/canonIconSeed.js', () => ({
  loadCanonIconSeed: () => ({ url: 'data:image/webp;base64,SEED', contentType: 'image/webp' }),
}));

// Mocked so the flow's registry key is observable. Unmocked it reaches Firestore,
// fails open to the code defaults, and the name this flow resolves under — the
// thing #935 makes overridable per flow — is invisible.
const mockResolveModel = vi.fn(async () => 'gemini-2.5-flash-image');
vi.mock('../../src/ai/resolveModel.js', () => ({ resolveModel: mockResolveModel }));

const { generateKitchenToolIconFlow } = await import('../../src/flows/generateKitchenToolIcon.js');

const DRAWN = { media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveModel.mockImplementation(async () => 'gemini-2.5-flash-image');
  mockGenerate.mockResolvedValue(DRAWN);
});

/** The text part of the single `ai.generate` call this run made. */
function promptText(): string {
  return mockGenerate.mock.calls[0]![0].prompt[1].text as string;
}

// The complete prompt for a tool with no hint, character for character. It twins
// `buildKitchenToolIconPrompt` in `src/flows/kitchenToolIconPrompt.ts`, whose
// style clause is the exported `KIT_STYLE_ANCHORS` constant.
const PROMPT_NO_HINT =
  'Generate a cute cartoon icon of Mixing bowl, one generic piece of kitchen equipment as found in a home kitchen. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only Mixing bowl and nothing else. Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style. Absolutely no lettering anywhere in the picture, including on the object itself: no brand name, no wordmark, no logo, no model number, no measurement markings, no letters, digits or symbols on the handle, the body, the blade, the rim or any display panel — leave every badge, panel and screen blank. Draw the object alone: no hands, no people, no food, no ingredients, no liquid, no worktop, no chopping surface, no kitchen scene, and nothing beside it for scale.';

// The same prompt with a one-shot hint appended as additive guidance. The locked
// wording ahead of it is untouched — that is what "additive" has to mean.
const PROMPT_WITH_HINT =
  'Generate a cute cartoon icon of Balloon whisk, one generic piece of kitchen equipment as found in a home kitchen. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only Balloon whisk and nothing else. Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style. Absolutely no lettering anywhere in the picture, including on the object itself: no brand name, no wordmark, no logo, no model number, no measurement markings, no letters, digits or symbols on the handle, the body, the blade, the rim or any display panel — leave every badge, panel and screen blank. Draw the object alone: no hands, no people, no food, no ingredients, no liquid, no worktop, no chopping surface, no kitchen scene, and nothing beside it for scale. Additional guidance for this item: make the wires finer';

describe('generateKitchenToolIcon flow', () => {
  it('returns the model image as base64 + contentType', async () => {
    const result = await (generateKitchenToolIconFlow as Function)({ label: 'Mixing bowl' });

    expect(result).toEqual({ imageBase64: 'QUJD', contentType: 'image/png' });
  });

  it('reference-conditions on the committed seed', async () => {
    await (generateKitchenToolIconFlow as Function)({ label: 'Mixing bowl' });

    // The seed media is the FIRST prompt part; the text follows it.
    expect(mockGenerate.mock.calls[0]![0].prompt[0]).toEqual({
      media: { url: 'data:image/webp;base64,SEED', contentType: 'image/webp' },
    });
  });

  it('builds the locked prompt exactly, with no hint', async () => {
    await (generateKitchenToolIconFlow as Function)({ label: 'Mixing bowl' });

    expect(promptText()).toBe(PROMPT_NO_HINT);
  });

  it('appends a hint as additive guidance and changes nothing ahead of it', async () => {
    await (generateKitchenToolIconFlow as Function)({
      label: 'Balloon whisk',
      hint: 'make the wires finer',
    });

    expect(promptText()).toBe(PROMPT_WITH_HINT);
  });

  it('resolves its model under its own registry key', async () => {
    await (generateKitchenToolIconFlow as Function)({ label: 'Mixing bowl' });

    // The three icon flows keep three distinct names because those names are
    // resolveModel registry keys (#935): collapsing them would silently repoint
    // every per-flow override.
    expect(mockResolveModel).toHaveBeenCalledWith('image', 'generateKitchenToolIcon');
    expect(mockGenerate.mock.calls[0]![0].model).toBe('gemini-2.5-flash-image');
  });

  it('throws a flow-attributed error when the model returns no image', async () => {
    mockGenerate.mockResolvedValue({ media: null });

    await expect(
      (generateKitchenToolIconFlow as Function)({ label: 'Mixing bowl' }),
    ).rejects.toThrow('generateKitchenToolIcon: model returned no image');
  });
});
