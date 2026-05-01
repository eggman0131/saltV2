import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCallable = vi.fn();

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => mockCallable),
}));

const { createGeminiEmbeddingAdapter } = await import('../src/geminiEmbedding.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GeminiEmbeddingAdapter — computeEmbedding', () => {
  it('returns ok with values from the callable response', async () => {
    const values = [0.1, 0.2, 0.3];
    mockCallable.mockResolvedValue({ data: { values } });

    const adapter = createGeminiEmbeddingAdapter();
    const result = await adapter.computeEmbedding('olive oil');

    expect(result).toEqual({ kind: 'ok', value: values });
    expect(mockCallable).toHaveBeenCalledWith({ text: 'olive oil' });
  });

  it('returns transient NetworkError when the callable throws a generic error', async () => {
    mockCallable.mockRejectedValue(new Error('network failure'));

    const adapter = createGeminiEmbeddingAdapter();
    const result = await adapter.computeEmbedding('tomato');

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'transient' } });
  });

  it('returns unreachable NetworkError for unauthenticated errors', async () => {
    const err = Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' });
    mockCallable.mockRejectedValue(err);

    const adapter = createGeminiEmbeddingAdapter();
    const result = await adapter.computeEmbedding('tomato');

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'unreachable' },
    });
  });

  it('reports errors to the ErrorReportingPort', async () => {
    const err = new Error('boom');
    mockCallable.mockRejectedValue(err);
    const errors = { report: vi.fn() };

    const adapter = createGeminiEmbeddingAdapter(errors);
    await adapter.computeEmbedding('test');

    expect(errors.report).toHaveBeenCalledWith(err);
  });
});

describe('GeminiEmbeddingAdapter — cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const adapter = createGeminiEmbeddingAdapter();
    expect(adapter.cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    const adapter = createGeminiEmbeddingAdapter();
    expect(adapter.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for a zero vector', () => {
    const adapter = createGeminiEmbeddingAdapter();
    expect(adapter.cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
