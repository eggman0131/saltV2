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

  // ─── Phase 2: per-flow override precedence ────────────────────────────────
  describe('per-flow overrides', () => {
    it('a per-flow override beats the role model', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { authorRecipe: 'flow-specific' } }),
      });
      expect(await resolveModel('fast', 'authorRecipe')).toBe('flow-specific');
    });

    it('a per-flow override only affects its own flow, not siblings on the role', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { authorRecipe: 'flow-specific' } }),
      });
      // The overridden flow gets its override...
      expect(await resolveModel('fast', 'authorRecipe')).toBe('flow-specific');
      // ...every other flow on the same role still gets the role model.
      expect(await resolveModel('fast', 'parseEntry')).toBe('role-fast');
      expect(await resolveModel('fast', 'arbitrateCanon')).toBe('role-fast');
    });

    it('a per-flow override beats the role default when the role is unset', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ perFlow: { chefChat: 'flow-pro' } }),
      });
      expect(await resolveModel('pro', 'chefChat')).toBe('flow-pro');
    });

    it('falls through to the role model when the flow has no override', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { chefChat: 'flow-pro' } }),
      });
      expect(await resolveModel('fast', 'authorRecipe')).toBe('role-fast');
    });

    it('falls through to the role default when neither override nor role is set', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
      expect(await resolveModel('fast', 'authorRecipe')).toBe(AI_MODEL_DEFAULTS.fast);
    });

    it('falls through to role/default when perFlow is absent entirely', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 'role-fast' }) });
      expect(await resolveModel('fast', 'authorRecipe')).toBe('role-fast');
      expect(await resolveModel('image', 'generateCanonIcon')).toBe(AI_MODEL_DEFAULTS.image);
    });

    it('ignores an empty override and fails open to defaults (empty value rejects the doc)', async () => {
      // An empty-string override fails the schema, so the whole doc is rejected
      // and the resolver fails open to defaults — exercising both the empty-value
      // guard and the fail-open path.
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { authorRecipe: '' } }),
      });
      expect(await resolveModel('fast', 'authorRecipe')).toBe(AI_MODEL_DEFAULTS.fast);
    });

    it('with no flowId, behaves exactly like role-only resolution (Phase 1 compat)', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { authorRecipe: 'flow-specific' } }),
      });
      // No flowId → the override is never consulted; the role model wins.
      expect(await resolveModel('fast')).toBe('role-fast');
    });
  });
});
