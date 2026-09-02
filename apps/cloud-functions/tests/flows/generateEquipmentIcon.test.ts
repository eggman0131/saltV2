/**
 * Characterisation net for the equipment icon flow (issue #877).
 *
 * Mirrors tests/flows/generateCanonIcon.test.ts. Written before #989 Phase 4
 * collapses the three flow bodies onto one factory, so it is what proves the
 * collapse changed nothing.
 *
 * This family is the one whose SUBJECT forks: with a brief the make and model
 * never reach the image model (the brief carries the likeness in brand-free
 * words), and without one the name is all that is left and the drawing lands at
 * genre level. Both branches are pinned below, because a factory that treated
 * the optional second argument as a canon-style "hint" would silently swap one
 * for the other.
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
import { AI_FLOW_ROLES } from '@salt/domain/schemas';

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

const { generateEquipmentIconFlow } = await import('../../src/flows/generateEquipmentIcon.js');

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

// The complete prompt on the DEGRADED path — no brief, so the item's name is the
// subject. Character for character. It twins `buildEquipmentIconPrompt` in
// `src/flows/equipmentIconPrompt.ts`, whose style clause is the exported
// `EQUIPMENT_STYLE_ANCHORS` constant.
const PROMPT_NO_BRIEF =
  'Generate a cute cartoon icon of Kenwood Chef KVC3100S, one piece of kitchen equipment. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only this one item and nothing else. Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style. Absolutely no lettering anywhere in the picture, including on the object itself: no brand name, no wordmark, no logo, no model number, no letters, digits or symbols on the body, the lid, the controls, the dials, the buttons or any display panel — leave every panel, badge and screen blank. Draw the object alone: no hands, no people, no food, no ingredients, no worktop, no wall, no kitchen scene, no cable trailing off the frame, and nothing beside it for scale.';

// The complete prompt when a brief is present: the brief IS the subject and the
// name is nowhere in it.
const PROMPT_WITH_BRIEF =
  'Generate a cute cartoon icon of one piece of kitchen equipment. Draw exactly this: a squat silver stand mixer with a domed head and a chrome bowl Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only this one item and nothing else. Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style. Absolutely no lettering anywhere in the picture, including on the object itself: no brand name, no wordmark, no logo, no model number, no letters, digits or symbols on the body, the lid, the controls, the dials, the buttons or any display panel — leave every panel, badge and screen blank. Draw the object alone: no hands, no people, no food, no ingredients, no worktop, no wall, no kitchen scene, no cable trailing off the frame, and nothing beside it for scale.';

const BRIEF = 'a squat silver stand mixer with a domed head and a chrome bowl';

describe('generateEquipmentIcon flow', () => {
  it('returns the model image as base64 + contentType', async () => {
    const result = await (generateEquipmentIconFlow as Function)({ name: 'Kenwood Chef KVC3100S' });

    expect(result).toEqual({ imageBase64: 'QUJD', contentType: 'image/png' });
  });

  it('reference-conditions on the committed seed', async () => {
    await (generateEquipmentIconFlow as Function)({ name: 'Kenwood Chef KVC3100S' });

    expect(mockGenerate.mock.calls[0]![0].prompt[0]).toEqual({
      media: { url: 'data:image/webp;base64,SEED', contentType: 'image/webp' },
    });
  });

  it('builds the locked prompt exactly on the degraded, brief-less path', async () => {
    await (generateEquipmentIconFlow as Function)({ name: 'Kenwood Chef KVC3100S' });

    expect(promptText()).toBe(PROMPT_NO_BRIEF);
  });

  it('builds the locked prompt exactly from the brief, and keeps the name out of it', async () => {
    await (generateEquipmentIconFlow as Function)({
      name: 'Kenwood Chef KVC3100S',
      brief: BRIEF,
    });

    expect(promptText()).toBe(PROMPT_WITH_BRIEF);
    // The strongest pull toward painting a wordmark is the make and model in
    // front of an image model. With a brief it must not be there at all.
    expect(promptText()).not.toContain('KVC3100S');
  });

  it('resolves its model under its own registry key', async () => {
    await (generateEquipmentIconFlow as Function)({ name: 'Kenwood Chef KVC3100S' });

    expect(mockResolveModel).toHaveBeenCalledWith('generateEquipmentIcon');
    expect(AI_FLOW_ROLES.generateEquipmentIcon).toBe('image');
    expect(mockGenerate.mock.calls[0]![0].model).toBe('gemini-2.5-flash-image');
  });

  it('throws a flow-attributed error when the model returns no image', async () => {
    mockGenerate.mockResolvedValue({ media: null });

    await expect(
      (generateEquipmentIconFlow as Function)({ name: 'Kenwood Chef KVC3100S' }),
    ).rejects.toThrow('generateEquipmentIcon: model returned no image');
  });
});
