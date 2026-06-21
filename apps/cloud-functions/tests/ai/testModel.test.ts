import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/https';

class FakeHttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
vi.mock('firebase-functions/https', () => ({ HttpsError: FakeHttpsError }));
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockRequireAdmin = vi.fn(async () => 'admin@example.com');
vi.mock('../../src/ai/requireAdmin.js', () => ({ requireAdmin: mockRequireAdmin }));

vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => Promise<unknown>) => op(),
}));

const mockGenerate = vi.fn();
const mockEmbed = vi.fn();
vi.mock('../../src/genkit.js', () => ({
  ai: {
    generate: (...a: unknown[]) => mockGenerate(...a),
    embed: (...a: unknown[]) => mockEmbed(...a),
  },
}));
vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: { model: (n: string) => `model:${n}`, embedder: (n: string) => `embedder:${n}` },
}));

const { handleTestModel } = await import('../../src/ai/testModel.js');

function req(data: unknown): CallableRequest {
  return { auth: { uid: 'u1' }, data } as unknown as CallableRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue('admin@example.com');
  mockGenerate.mockResolvedValue({ text: 'ok' });
  mockEmbed.mockResolvedValue([{ embedding: [0.1] }]);
});

describe('handleTestModel', () => {
  it('re-checks admin', async () => {
    await handleTestModel(req({ model: 'gemini-flash-latest' }));
    expect(mockRequireAdmin).toHaveBeenCalledOnce();
  });

  it('rejects an invalid payload', async () => {
    await expect(handleTestModel(req({ model: '' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('returns ok for a successful generate ping', async () => {
    const result = await handleTestModel(req({ model: 'gemini-flash-latest', role: 'fast' }));
    expect(result).toEqual({ ok: true });
    expect(mockGenerate).toHaveBeenCalledOnce();
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('uses an embed ping for the embedding role', async () => {
    const result = await handleTestModel(req({ model: 'gemini-embedding-001', role: 'embedding' }));
    expect(result).toEqual({ ok: true });
    expect(mockEmbed).toHaveBeenCalledOnce();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns ok:false with the error message when the probe throws', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('model not found'));
    const result = await handleTestModel(req({ model: 'bogus-model', role: 'fast' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('model not found');
  });
});
