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

// Avoid reading the real ~1MB seed PNG; the smoke test only cares that a
// reference media part is passed through.
vi.mock('../../src/flows/assets/canonIconSeed.js', () => ({
  loadCanonIconSeed: () => ({ url: 'data:image/png;base64,SEED', contentType: 'image/png' }),
}));

const { generateCanonIconFlow } = await import('../../src/flows/generateCanonIcon.js');

beforeEach(() => {
  vi.clearAllMocks();
});

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
      media: { url: 'data:image/png;base64,SEED', contentType: 'image/png' },
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

  it('throws when the model returns no image', async () => {
    mockGenerate.mockResolvedValue({ media: null });

    await expect((generateCanonIconFlow as Function)({ name: 'milk' })).rejects.toThrow(/no image/);
  });
});
