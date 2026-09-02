/**
 * Characterisation net for the canon-item icon flow (issue #148) — the template
 * the equipment and kitchen-tool suites beside it are modelled on.
 *
 * THE PROMPT IS PINNED BY EXACT EQUALITY as of #989 Phase 3, alongside the
 * `toContain` checks that were here before. docs/canon-icons.md:351 records that
 * this wording is reproduced verbatim and that paraphrasing drifts the house
 * style — and `toContain` cannot see a paraphrase: it goes green over a
 * reordered clause, a dropped sentence, or a whole new one appended. The two
 * literals below are a deliberate second copy of locked wording, which is what
 * makes them a CHANGE DETECTOR rather than a second source of truth: nothing but
 * this file reads them, and #990 — which realigns the style anchors — is meant to
 * turn them red so its diff can be reviewed on before/after imagery rather than
 * on argument. Update them with the change; never around it.
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

// Avoid reading the real seed asset; the smoke test only cares that a
// reference media part is passed through.
vi.mock('../../src/flows/assets/canonIconSeed.js', () => ({
  loadCanonIconSeed: () => ({ url: 'data:image/webp;base64,SEED', contentType: 'image/webp' }),
}));

// Mocked so the flow's registry key is observable. Unmocked it reaches Firestore,
// fails open to the code defaults, and the name this flow resolves under — the
// thing #935 makes overridable per flow — is invisible.
const mockResolveModel = vi.fn(async () => 'gemini-2.5-flash-image');
vi.mock('../../src/ai/resolveModel.js', () => ({ resolveModel: mockResolveModel }));

const { generateCanonIconFlow } = await import('../../src/flows/generateCanonIcon.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveModel.mockImplementation(async () => 'gemini-2.5-flash-image');
});

// Source of truth for every character below: `buildIconPrompt` in
// `src/flows/generateCanonIcon.ts`, whose closing clause is the exported `STYLE`
// constant (`UK` is the sentence after the subject). Change either and update
// these literals by hand in the same commit.
const PROMPT_NO_HINT =
  'Generate a cute cartoon icon of milk. The item is as commonly sold in a UK supermarket. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only milk and nothing else. Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style.';

const PROMPT_WITH_HINT =
  'Generate a cute cartoon icon of baked beans. The item is as commonly sold in a UK supermarket. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only baked beans and nothing else. Flat vector cartoon illustration. A single centered subject filling most of the frame. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style. Additional guidance for this item: show it as a tin';

describe('generateCanonIcon flow', () => {
  it('returns the model image as base64 + contentType', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    const result = await (generateCanonIconFlow as Function)({ name: 'milk' });

    expect(result).toEqual({ imageBase64: 'QUJD', contentType: 'image/png' });
  });

  it('reference-conditions on the committed seed and includes the item + verbatim style', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateCanonIconFlow as Function)({ name: 'two litre plastic bottle of milk' });

    const opts = mockGenerate.mock.calls[0]![0];
    // Reference image (seed) is the first prompt part.
    expect(opts.prompt[0]).toEqual({
      media: { url: 'data:image/webp;base64,SEED', contentType: 'image/webp' },
    });
    const text = opts.prompt[1].text as string;
    expect(text).toContain('two litre plastic bottle of milk');
    expect(text).toContain('The item is as commonly sold in a UK supermarket.');
    expect(text).toContain('Flat vector cartoon illustration.');
    expect(text).toContain('app sticker / emoji style.');
    // Seed-coupled negatives are present (keyed to the red-apple seed).
    expect(text).toContain('Do NOT copy the apple');
  });

  it('appends an optional hint as additive guidance', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateCanonIconFlow as Function)({ name: 'baked beans', hint: 'show it as a tin' });

    const text = mockGenerate.mock.calls[0]![0].prompt[1].text as string;
    expect(text).toContain('Additional guidance for this item: show it as a tin');
    // The locked house-style wording is still present, unchanged.
    expect(text).toContain('Flat vector cartoon illustration.');
  });

  it('omits the guidance clause when no hint is given', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateCanonIconFlow as Function)({ name: 'milk' });

    const text = mockGenerate.mock.calls[0]![0].prompt[1].text as string;
    expect(text).not.toContain('Additional guidance');
  });

  it('builds the locked prompt exactly, with no hint', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateCanonIconFlow as Function)({ name: 'milk' });

    expect(mockGenerate.mock.calls[0]![0].prompt[1].text).toBe(PROMPT_NO_HINT);
  });

  it('builds the locked prompt exactly with a hint, changing nothing ahead of it', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateCanonIconFlow as Function)({ name: 'baked beans', hint: 'show it as a tin' });

    expect(mockGenerate.mock.calls[0]![0].prompt[1].text).toBe(PROMPT_WITH_HINT);
  });

  it('resolves its model under its own registry key', async () => {
    mockGenerate.mockResolvedValue({
      media: { url: 'data:image/png;base64,QUJD', contentType: 'image/png' },
    });

    await (generateCanonIconFlow as Function)({ name: 'milk' });

    // The three icon flows keep three distinct names because those names are
    // resolveModel registry keys (#935): collapsing them would silently repoint
    // every per-flow override.
    expect(mockResolveModel).toHaveBeenCalledWith('generateCanonIcon');
    expect(AI_FLOW_ROLES.generateCanonIcon).toBe('image');
    expect(mockGenerate.mock.calls[0]![0].model).toBe('gemini-2.5-flash-image');
  });

  it('throws when the model returns no image', async () => {
    mockGenerate.mockResolvedValue({ media: null });

    await expect((generateCanonIconFlow as Function)({ name: 'milk' })).rejects.toThrow(
      'generateCanonIcon: model returned no image',
    );
  });
});
