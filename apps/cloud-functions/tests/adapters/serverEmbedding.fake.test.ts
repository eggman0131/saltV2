import { describe, it, expect, vi, beforeEach } from 'vitest';

// The batch path (`computeEmbeddings`) invokes the embedder directly rather than
// through embedTextFlow, so it needs its own FUNCTIONS_AI_FAKE short-circuit —
// without it every canon batch in the e2e stack made a live Gemini call with the
// dummy emulator key (issue #686).
let fakeOn = false;

const mockEmbed = vi.fn();

vi.mock('../../src/genkit.js', () => ({ ai: { embed: mockEmbed } }));
vi.mock('@genkit-ai/google-genai', () => ({ googleAI: { embedder: (name: string) => name } }));
vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: vi.fn() }));
vi.mock('../../src/ai/resolveModel.js', () => ({
  resolveModel: async () => 'gemini-embedding-001',
}));
vi.mock('../../src/ai/fakeModel.js', () => ({ aiFakeEnabled: () => fakeOn }));

const { createServerEmbeddingAdapter } = await import('../../src/adapters/serverEmbedding.js');
const { fakeEmbedding } = await import('../../src/ai/fakeEmbedding.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakeOn = false;
});

describe('serverEmbedding.computeEmbeddings', () => {
  it('returns fake vectors without touching the embedder when the e2e flag is on', async () => {
    fakeOn = true;

    const result = await createServerEmbeddingAdapter().computeEmbeddings!(['garlic', 'lime']);

    expect(result).toEqual({
      kind: 'ok',
      value: [fakeEmbedding('garlic'), fakeEmbedding('lime')],
    });
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('calls the real embedder when the flag is off', async () => {
    mockEmbed.mockResolvedValue([{ embedding: [0.5] }]);

    const result = await createServerEmbeddingAdapter().computeEmbeddings!(['garlic']);

    expect(result).toEqual({ kind: 'ok', value: [[0.5]] });
    expect(mockEmbed).toHaveBeenCalledWith({
      embedder: 'gemini-embedding-001',
      content: 'garlic',
    });
  });
});
