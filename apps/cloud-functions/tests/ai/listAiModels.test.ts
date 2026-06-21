import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/https';

// ─── Mocks ───────────────────────────────────────────────────────────────────
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

// requireAdmin is exercised separately; here we stub it so list logic is the
// unit under test (and toggle it to assert the admin gate is invoked).
const mockRequireAdmin = vi.fn(async () => 'admin@example.com');
vi.mock('../../src/ai/requireAdmin.js', () => ({ requireAdmin: mockRequireAdmin }));

// withAiTimeout just runs the op in tests.
vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => Promise<unknown>) => op(),
}));

const { handleListAiModels, __resetListAiModelsCacheForTest } =
  await import('../../src/ai/listAiModels.js');

const CATALOG = {
  models: [
    {
      name: 'models/gemini-flash-latest',
      displayName: 'Gemini Flash',
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemini-pro-latest',
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemini-embedding-001',
      supportedGenerationMethods: ['embedContent'],
    },
    {
      name: 'models/gemini-2.5-flash-image',
      description: 'image generation',
      supportedGenerationMethods: ['generateContent'],
    },
    // Malformed entry — must be skipped, not fail the whole catalog.
    { displayName: 'no name field' },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

function req(data: unknown): CallableRequest {
  return { auth: { uid: 'u1' }, data } as unknown as CallableRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetListAiModelsCacheForTest();
  mockRequireAdmin.mockResolvedValue('admin@example.com');
  process.env['GEMINI_API_KEY'] = 'test-key';
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => CATALOG,
  }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('handleListAiModels', () => {
  it('re-checks admin', async () => {
    await handleListAiModels(req({}));
    expect(mockRequireAdmin).toHaveBeenCalledOnce();
  });

  it('filters the catalog per role', async () => {
    const result = await handleListAiModels(req({}));
    expect(result.byRole.fast.map((m) => m.name)).toEqual([
      'gemini-flash-latest',
      'gemini-pro-latest',
    ]);
    expect(result.byRole.pro.map((m) => m.name)).toEqual([
      'gemini-flash-latest',
      'gemini-pro-latest',
    ]);
    expect(result.byRole.embedding.map((m) => m.name)).toEqual(['gemini-embedding-001']);
    expect(result.byRole.image.map((m) => m.name)).toEqual(['gemini-2.5-flash-image']);
  });

  it('caches across calls and forceRefresh bypasses the cache', async () => {
    await handleListAiModels(req({}));
    await handleListAiModels(req({}));
    expect(fetchMock).toHaveBeenCalledTimes(1); // second served from cache

    await handleListAiModels(req({ forceRefresh: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2); // bypassed
  });

  it('errors when the API key is missing', async () => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    await expect(handleListAiModels(req({}))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('errors when the catalog fetch is non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(handleListAiModels(req({}))).rejects.toMatchObject({ code: 'unavailable' });
  });
});
