import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AI_MODEL_DEFAULTS } from '@salt/domain/schemas';

// ─── Mock firebase-functions logger ──────────────────────────────────────────
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Mock firebase-admin/firestore ───────────────────────────────────────────
// A single mutable handle the tests reconfigure per-case; the resolver always
// reads appSettings/singleton.
const mockGet = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (_name: string) => ({
      doc: (_id: string) => ({ get: mockGet }),
    }),
  }),
}));

const { resolveModel, __resetResolveModelCacheForTest } =
  await import('../../src/ai/resolveModel.js');

beforeEach(() => {
  vi.clearAllMocks();
  __resetResolveModelCacheForTest();
});

describe('resolveModel', () => {
  it('falls back to defaults when the doc is absent', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await resolveModel('fast')).toBe(AI_MODEL_DEFAULTS.fast);
    expect(await resolveModel('pro')).toBe(AI_MODEL_DEFAULTS.pro);
    expect(await resolveModel('embedding')).toBe(AI_MODEL_DEFAULTS.embedding);
    expect(await resolveModel('image')).toBe(AI_MODEL_DEFAULTS.image);
  });

  it('falls back to defaults when the doc is invalid (corrupt)', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 123 }) });
    expect(await resolveModel('fast')).toBe(AI_MODEL_DEFAULTS.fast);
  });

  it('falls back to defaults when the doc is empty', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    expect(await resolveModel('fast')).toBe(AI_MODEL_DEFAULTS.fast);
    expect(await resolveModel('image')).toBe(AI_MODEL_DEFAULTS.image);
  });

  it('falls back to defaults when the read throws', async () => {
    mockGet.mockRejectedValue(new Error('unavailable'));
    expect(await resolveModel('embedding')).toBe(AI_MODEL_DEFAULTS.embedding);
  });

  it('returns the configured model for a role', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 'custom-fast-model' }) });
    expect(await resolveModel('fast')).toBe('custom-fast-model');
    // Unset roles still fall back to their defaults.
    expect(await resolveModel('pro')).toBe(AI_MODEL_DEFAULTS.pro);
  });

  it('caches reads within the TTL (one Firestore read across roles)', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 'cached-fast' }) });
    await resolveModel('fast');
    await resolveModel('pro');
    await resolveModel('image');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
