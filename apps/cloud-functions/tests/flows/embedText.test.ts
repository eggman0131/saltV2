import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmbed = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    embed: mockEmbed,
  },
}));

vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: {
    embedder: (name: string) => name,
  },
}));

let fakeOn = false;
vi.mock('../../src/ai/fakeModel.js', () => ({ aiFakeEnabled: () => fakeOn }));

// Import after mocks so defineFlow returns the handler directly.
const { embedTextFlow } = await import('../../src/flows/embedText.js');
const { fakeEmbedding } = await import('../../src/ai/fakeEmbedding.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakeOn = false;
});

describe('embedText flow', () => {
  it('returns embedding values from ai.embed', async () => {
    const values = [0.1, 0.2, 0.3];
    mockEmbed.mockResolvedValue([{ embedding: values }]);

    const result = await (embedTextFlow as Function)({ text: 'olive oil' });

    expect(result).toEqual({ values });
    expect(mockEmbed).toHaveBeenCalledWith({
      embedder: 'gemini-embedding-001',
      content: 'olive oil',
    });
  });

  it('passes the text content to the embedder unchanged', async () => {
    mockEmbed.mockResolvedValue([{ embedding: [1, 2] }]);

    await (embedTextFlow as Function)({ text: 'cherry tomatoes' });

    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ content: 'cherry tomatoes' }));
  });

  // E2E seam: a canned, text-derived vector instead of a live embed call.
  it('short-circuits to a deterministic stand-in under the e2e fake flag', async () => {
    fakeOn = true;

    const result = await (embedTextFlow as Function)({ text: 'olive oil' });

    expect(result).toEqual({ values: fakeEmbedding('olive oil') });
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
