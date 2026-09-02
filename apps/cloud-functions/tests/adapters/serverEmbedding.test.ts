import { describe, it, expect, vi, beforeEach } from 'vitest';

// One embedding job, one implementation (issue #935). The batch path
// (`computeEmbeddings`) used to resolve an embedder and call `ai.embed` inline,
// which gave it its own registry key, its own FUNCTIONS_AI_FAKE short-circuit
// (issue #686) and its own timeout budget for the same job the single-item path
// already did. These tests pin the delegation itself: inline a second embed call
// here and the first case goes red, because `embedTextFlow` stops being called.
//
// The delegation is what makes the three properties hold for a batch without
// being restated for it — the model resolved (`embedText`), the e2e fake seam,
// and the per-call deadline all live in `flows/embedText.ts` and are pinned by
// `tests/flows/embedText.test.ts`. That is the boundary of what this file
// claims: it proves the batch goes through that flow, not what the flow does.
const mockEmbedTextFlow = vi.fn();

vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: mockEmbedTextFlow }));

const { createServerEmbeddingAdapter } = await import('../../src/adapters/serverEmbedding.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('serverEmbedding: both halves run the same embedding job', () => {
  it('computeEmbeddings runs embedTextFlow once per text, results in input order', async () => {
    mockEmbedTextFlow.mockImplementation(async ({ text }: { text: string }) => ({
      values: [text.length],
    }));

    const result = await createServerEmbeddingAdapter().computeEmbeddings!(['garlic', 'lime']);

    expect(result).toEqual({ kind: 'ok', value: [[6], [4]] });
    expect(mockEmbedTextFlow).toHaveBeenCalledTimes(2);
    expect(mockEmbedTextFlow).toHaveBeenNthCalledWith(1, { text: 'garlic' });
    expect(mockEmbedTextFlow).toHaveBeenNthCalledWith(2, { text: 'lime' });
  });

  it('computeEmbedding runs the same flow, so single and batch cannot diverge', async () => {
    mockEmbedTextFlow.mockResolvedValue({ values: [0.5] });

    const result = await createServerEmbeddingAdapter().computeEmbedding('garlic');

    expect(result).toEqual({ kind: 'ok', value: [0.5] });
    expect(mockEmbedTextFlow).toHaveBeenCalledWith({ text: 'garlic' });
  });

  it('maps a failing batch to a transient NetworkError rather than throwing', async () => {
    mockEmbedTextFlow.mockRejectedValue(new Error('upstream stalled'));

    const result = await createServerEmbeddingAdapter().computeEmbeddings!(['garlic']);

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'transient' } });
  });
});
