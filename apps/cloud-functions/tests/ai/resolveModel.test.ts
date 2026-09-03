import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AI_MODEL_DEFAULTS,
  AI_FLOW_IDS,
  AI_FLOW_ROLES,
  AI_MODEL_ROLES,
  type AiModelRole,
} from '@salt/domain/schemas';

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
  // Representative flow per role. `resolveModel` takes a flow id only (#935);
  // the role comes from AI_FLOW_ROLES, so a case about "the fast role" is
  // written as a flow that the registry puts on `fast`.
  const FLOW_ON: Record<AiModelRole, (typeof AI_FLOW_IDS)[number]> = {
    fast: 'authorRecipe',
    lite: 'parseEntry',
    pro: 'chefChat',
    embedding: 'embedText',
    image: 'generateCanonIcon',
  };

  it('falls back to defaults when the doc is absent', async () => {
    mockGet.mockResolvedValue({ exists: false });
    for (const role of AI_MODEL_ROLES) {
      expect(await resolveModel(FLOW_ON[role])).toBe(AI_MODEL_DEFAULTS[role]);
    }
  });

  // ─── The registry is what picks the role (#935) ───────────────────────────
  // The guard this issue exists for: the role is NOT a call-site argument any
  // more, it is `AI_FLOW_ROLES[flowId]`. Pin it across every registered flow, so
  // a flow whose registry tier is edited (or a new one added on the wrong tier)
  // shows up here rather than silently resolving to whatever a call site said.
  it('resolves every registered flow on the tier the registry gives it', async () => {
    const configured: Record<AiModelRole, string> = {
      fast: 'role-fast',
      lite: 'role-lite',
      pro: 'role-pro',
      embedding: 'role-embedding',
      image: 'role-image',
    };
    mockGet.mockResolvedValue({ exists: true, data: () => configured });
    for (const flowId of AI_FLOW_IDS) {
      expect(await resolveModel(flowId)).toBe(configured[AI_FLOW_ROLES[flowId]]);
    }
  });

  // ─── Lite role (reassigned flows) ─────────────────────────────────────────
  // parseRecipeIngredients (and its siblings) moved from `fast` to `lite`. The
  // contract is: a reassigned flow falls open to the lite default when the doc
  // is absent or invalid, and honours a configured/overridden lite value.
  describe('lite role', () => {
    it('resolves the lite default for a reassigned flow when the doc is absent', async () => {
      mockGet.mockResolvedValue({ exists: false });
      expect(await resolveModel('parseRecipeIngredients')).toBe(AI_MODEL_DEFAULTS.lite);
    });

    it('resolves the lite default for a reassigned flow when the doc is invalid', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({ lite: 123 }) });
      expect(await resolveModel('parseRecipeIngredients')).toBe(AI_MODEL_DEFAULTS.lite);
    });

    it('honours a configured lite role value', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({ lite: 'custom-lite-model' }) });
      expect(await resolveModel('parseRecipeIngredients')).toBe('custom-lite-model');
    });

    it('honours a per-flow override over the lite role value', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ lite: 'role-lite', perFlow: { parseRecipeIngredients: 'flow-lite' } }),
      });
      expect(await resolveModel('parseRecipeIngredients')).toBe('flow-lite');
    });
  });

  // ─── The two flows the registry was missing (#935) ────────────────────────
  // Both resolved a model with no registry entry before this issue, so neither
  // could be overridden from /admin/app-settings at all. These are the cases
  // that were impossible to write.
  describe('newly registered flows', () => {
    it('categoriseRecipe resolves on `fast` and honours its own override', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { categoriseRecipe: 'flow-categorise' } }),
      });
      expect(await resolveModel('categoriseRecipe')).toBe('flow-categorise');
      // ...and the sibling on the same tier is untouched by it.
      expect(await resolveModel('authorRecipe')).toBe('role-fast');
    });

    it('arbitrateProductForm resolves on `lite` and honours its own override', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ lite: 'role-lite', perFlow: { arbitrateProductForm: 'flow-product-form' } }),
      });
      expect(await resolveModel('arbitrateProductForm')).toBe('flow-product-form');
      expect(await resolveModel('arbitrateCanon')).toBe('role-lite');
    });
  });

  it('falls back to defaults when the doc is invalid (corrupt)', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 123 }) });
    expect(await resolveModel('authorRecipe')).toBe(AI_MODEL_DEFAULTS.fast);
  });

  it('falls back to defaults when the doc is empty', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    expect(await resolveModel('authorRecipe')).toBe(AI_MODEL_DEFAULTS.fast);
    expect(await resolveModel('generateCanonIcon')).toBe(AI_MODEL_DEFAULTS.image);
  });

  it('falls back to defaults when the read throws', async () => {
    mockGet.mockRejectedValue(new Error('unavailable'));
    expect(await resolveModel('embedText')).toBe(AI_MODEL_DEFAULTS.embedding);
  });

  it('returns the configured model for a role', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 'custom-fast-model' }) });
    expect(await resolveModel('authorRecipe')).toBe('custom-fast-model');
    // Unset roles still fall back to their defaults.
    expect(await resolveModel('chefChat')).toBe(AI_MODEL_DEFAULTS.pro);
  });

  it('caches reads within the TTL (one Firestore read across roles)', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 'cached-fast' }) });
    await resolveModel('authorRecipe');
    await resolveModel('chefChat');
    await resolveModel('generateCanonIcon');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  // ─── Phase 2: per-flow override precedence ────────────────────────────────
  describe('per-flow overrides', () => {
    it('a per-flow override beats the role model', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { authorRecipe: 'flow-specific' } }),
      });
      expect(await resolveModel('authorRecipe')).toBe('flow-specific');
    });

    it('a per-flow override only affects its own flow, not siblings on the role', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { authorRecipe: 'flow-specific' } }),
      });
      // The overridden flow gets its override...
      expect(await resolveModel('authorRecipe')).toBe('flow-specific');
      // ...every other flow on the same role still gets the role model.
      expect(await resolveModel('identifyEquipment')).toBe('role-fast');
      expect(await resolveModel('describeRecipeScene')).toBe('role-fast');
    });

    it('a per-flow override beats the role default when the role is unset', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ perFlow: { chefChat: 'flow-pro' } }),
      });
      expect(await resolveModel('chefChat')).toBe('flow-pro');
    });

    it('falls through to the role model when the flow has no override', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { chefChat: 'flow-pro' } }),
      });
      expect(await resolveModel('authorRecipe')).toBe('role-fast');
    });

    it('falls through to the role default when neither override nor role is set', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
      expect(await resolveModel('authorRecipe')).toBe(AI_MODEL_DEFAULTS.fast);
    });

    it('falls through to role/default when perFlow is absent entirely', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => ({ fast: 'role-fast' }) });
      expect(await resolveModel('authorRecipe')).toBe('role-fast');
      expect(await resolveModel('generateCanonIcon')).toBe(AI_MODEL_DEFAULTS.image);
    });

    it('ignores an empty override and fails open to defaults (empty value rejects the doc)', async () => {
      // An empty-string override fails the schema, so the whole doc is rejected
      // and the resolver fails open to defaults — exercising both the empty-value
      // guard and the fail-open path.
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { authorRecipe: '' } }),
      });
      expect(await resolveModel('authorRecipe')).toBe(AI_MODEL_DEFAULTS.fast);
    });

    it('ignores an override stored against a retired/unknown flow id', async () => {
      // `perFlow` is a free-form record, so a key that is no longer (or never
      // was) a registered flow id parses fine and is simply never read.
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fast: 'role-fast', perFlow: { notAFlowAnyMore: 'ghost-model' } }),
      });
      expect(await resolveModel('authorRecipe')).toBe('role-fast');
    });
  });
});
