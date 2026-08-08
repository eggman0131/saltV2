import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetDocFromCache, mockDoc, mockGetFirestore } = vi.hoisted(() => ({
  mockGetDocFromCache: vi.fn(),
  mockDoc: vi.fn(() => 'mock-doc-ref'),
  mockGetFirestore: vi.fn(() => 'mock-db'),
}));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  doc: mockDoc,
  getDocFromCache: mockGetDocFromCache,
}));

import { probeFirestoreCache } from '../src/e2eFirestoreProbe.js';

function snapshot(data: unknown, hasPendingWrites = false) {
  return {
    exists: () => data !== undefined,
    data: () => data,
    metadata: { hasPendingWrites, fromCache: true },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('probeFirestoreCache', () => {
  it('reads the given path from the cache, never the network', async () => {
    mockGetDocFromCache.mockResolvedValue(snapshot({ updatedAt: '2026-08-08T00:00:00.000Z' }));

    const probe = await probeFirestoreCache('canonData/aisles');

    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'canonData/aisles');
    expect(probe).toEqual({
      path: 'canonData/aisles',
      inCache: true,
      exists: true,
      hasPendingWrites: false,
      updatedAt: '2026-08-08T00:00:00.000Z',
      error: null,
    });
  });

  it('reports a cached document with no updatedAt as null rather than omitting it', async () => {
    mockGetDocFromCache.mockResolvedValue(snapshot({ defaultListId: 'list-1' }, true));

    const probe = await probeFirestoreCache('shoppingListsConfig/singleton');

    expect(probe.exists).toBe(true);
    expect(probe.hasPendingWrites).toBe(true);
    expect(probe.updatedAt).toBeNull();
  });

  it('reports a cached "does not exist" as in-cache but absent', async () => {
    mockGetDocFromCache.mockResolvedValue(snapshot(undefined));

    const probe = await probeFirestoreCache('canonData/aisles');

    expect(probe.inCache).toBe(true);
    expect(probe.exists).toBe(false);
    expect(probe.error).toBeNull();
  });

  it('treats the absent-from-cache rejection as a result, not an error', async () => {
    mockGetDocFromCache.mockRejectedValue(
      Object.assign(new Error('Failed to get document from cache.'), { code: 'unavailable' }),
    );

    const probe = await probeFirestoreCache('canonData/aisles');

    expect(probe).toEqual({
      path: 'canonData/aisles',
      inCache: false,
      exists: null,
      hasPendingWrites: null,
      updatedAt: null,
      error: null,
    });
  });

  it('never throws — an unexpected failure is reported in `error`', async () => {
    mockGetDocFromCache.mockRejectedValue(new Error('boom'));

    await expect(probeFirestoreCache('canonData/aisles')).resolves.toMatchObject({
      inCache: false,
      error: 'boom',
    });
  });

  it('never throws — a broken Firestore handle is reported, not raised', async () => {
    mockGetFirestore.mockImplementationOnce(() => {
      throw new Error('no app');
    });

    await expect(probeFirestoreCache('canonData/aisles')).resolves.toMatchObject({
      inCache: false,
      error: 'no app',
    });
  });
});
