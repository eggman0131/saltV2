import { describe, it, expect } from 'vitest';
import { getAisleUsage } from '@salt/domain';
import type { AisleStorePort, CanonLocalStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function makeAisleStore(initial: Aisle[] = []): AisleStorePort {
  return {
    load: async () => ({ kind: 'ok', value: [...initial] }),
    save: async (aisles) => ({ kind: 'ok', value: aisles }),
  };
}

function makeCanonStore(initial: CanonItem[] = []): CanonLocalStorePort {
  const items = [...initial];
  return {
    list: async () => ({ kind: 'ok', value: items }),
    load: async (id) => ({ kind: 'ok', value: items.find((i) => i.id === id) ?? null }),
    upsert: async (item) => ({ kind: 'ok', value: item }),
    delete: async () => ({ kind: 'ok', value: undefined }),
    getManifestCursor: async () => ({ kind: 'ok', value: null }),
    setManifestCursor: async () => ({ kind: 'ok', value: undefined }),
    enqueuePendingWrite: async () => ({ kind: 'ok', value: undefined }),
    drainPendingWrites: async () => ({ kind: 'ok', value: [] }),
  };
}

function canonItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    ...overrides,
  };
}

describe('getAisleUsage', () => {
  it('returns 0 counts for aisles with no items', async () => {
    const aisleStore = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const canonStore = makeCanonStore();
    const result = await getAisleUsage(aisleStore, canonStore);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.get('a1')).toBe(0);
  });

  it('counts items per aisle correctly', async () => {
    const aisleStore = makeAisleStore([
      { id: 'a1', name: 'Produce', order: 0 },
      { id: 'a2', name: 'Dairy', order: 1 },
    ]);
    const canonStore = makeCanonStore([
      canonItem({ id: 'c1', name: 'Tomato', aisleId: 'a1' }),
      canonItem({ id: 'c2', name: 'Carrot', aisleId: 'a1' }),
      canonItem({ id: 'c3', name: 'Milk', aisleId: 'a2' }),
    ]);
    const result = await getAisleUsage(aisleStore, canonStore);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.get('a1')).toBe(2);
    expect(result.value.get('a2')).toBe(1);
  });

  it('ignores items with null aisleId', async () => {
    const aisleStore = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const canonStore = makeCanonStore([canonItem({ id: 'c1', name: 'Tomato', aisleId: null })]);
    const result = await getAisleUsage(aisleStore, canonStore);
    expect(result.kind === 'ok' && result.value.get('a1')).toBe(0);
  });

  it('ignores items referencing unknown aisle ids', async () => {
    const aisleStore = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const canonStore = makeCanonStore([
      canonItem({ id: 'c1', name: 'Tomato', aisleId: 'stale-id' }),
    ]);
    const result = await getAisleUsage(aisleStore, canonStore);
    expect(result.kind === 'ok' && result.value.get('a1')).toBe(0);
    expect(result.kind === 'ok' && result.value.has('stale-id')).toBe(false);
  });

  it('propagates aisle store load failure', async () => {
    const aisleStore: AisleStorePort = {
      load: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      save: async (aisles) => ({ kind: 'ok', value: aisles }),
    };
    const result = await getAisleUsage(aisleStore, makeCanonStore());
    expect(result.kind).toBe('err');
  });

  it('propagates canon store list failure', async () => {
    const aisleStore = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const canonStore: CanonLocalStorePort = {
      list: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      load: async () => ({ kind: 'ok', value: null }),
      upsert: async (item) => ({ kind: 'ok', value: item }),
      delete: async () => ({ kind: 'ok', value: undefined }),
      getManifestCursor: async () => ({ kind: 'ok', value: null }),
      setManifestCursor: async () => ({ kind: 'ok', value: undefined }),
      enqueuePendingWrite: async () => ({ kind: 'ok', value: undefined }),
      drainPendingWrites: async () => ({ kind: 'ok', value: [] }),
    };
    const result = await getAisleUsage(aisleStore, canonStore);
    expect(result.kind).toBe('err');
  });
});
