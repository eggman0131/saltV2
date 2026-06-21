import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';

vi.mock('@salt/firebase-sync', () => ({
  callListAiModels: vi.fn(),
  callTestModel: vi.fn(),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  catalogByRole,
  hasCatalog,
  isCatalogUnavailable,
  ensureCatalog,
  refreshCatalog,
  testModel,
  __resetAiModelCatalogServiceForTest,
} from '../src/lib/aiModelCatalogService.js';

const fs = firebaseSync as unknown as Mocked<typeof firebaseSync>;

const CATALOG = {
  byRole: {
    fast: [{ name: 'gemini-flash-latest', displayName: 'Gemini Flash' }],
    pro: [{ name: 'gemini-pro-latest', displayName: 'Gemini Pro' }],
    embedding: [{ name: 'gemini-embedding-001', displayName: 'Embedding' }],
    image: [{ name: 'gemini-2.5-flash-image', displayName: 'Image' }],
  },
  fetchedAt: 1_700_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetAiModelCatalogServiceForTest();
});

describe('aiModelCatalogService', () => {
  it('loads the per-role catalog on ensureCatalog', async () => {
    fs.callListAiModels.mockResolvedValue({ kind: 'ok', value: CATALOG });
    await ensureCatalog();
    expect(get(hasCatalog)).toBe(true);
    expect(get(isCatalogUnavailable)).toBe(false);
    expect(get(catalogByRole).fast.map((m) => m.name)).toEqual(['gemini-flash-latest']);
  });

  it('falls back to empty (free-text) when the catalog is unavailable', async () => {
    fs.callListAiModels.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    });
    await ensureCatalog();
    expect(get(hasCatalog)).toBe(false);
    expect(get(isCatalogUnavailable)).toBe(true);
    for (const role of ['fast', 'pro', 'embedding', 'image'] as const) {
      expect(get(catalogByRole)[role]).toEqual([]);
    }
  });

  it('forces a fresh fetch on refresh', async () => {
    fs.callListAiModels.mockResolvedValue({ kind: 'ok', value: CATALOG });
    await refreshCatalog();
    expect(fs.callListAiModels).toHaveBeenCalledWith(true);
  });

  it('surfaces a test-model failure as ok:false', async () => {
    fs.callTestModel.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    });
    const result = await testModel('gemini-flash-latest', 'fast');
    expect(result.ok).toBe(false);
  });

  it('passes through a successful probe result', async () => {
    fs.callTestModel.mockResolvedValue({ kind: 'ok', value: { ok: true } });
    const result = await testModel('gemini-flash-latest', 'fast');
    expect(result.ok).toBe(true);
  });
});
