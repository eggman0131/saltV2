import { describe, it, expect } from 'vitest';
import { deleteAisles } from '@salt/domain';
import type { AisleLocalStorePort, CanonLocalStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function makeAisleStore(initial: Aisle[] = []): AisleLocalStorePort & { items: Aisle[] } {
  const items = [...initial];
  return {
    items,
    load: async () => ({ kind: 'ok', value: items }),
    save: async (aisles) => {
      items.length = 0;
      items.push(...aisles);
      return { kind: 'ok', value: undefined };
    },
  };
}

function makeCanonStore(initial: CanonItem[] = []): CanonLocalStorePort & { items: CanonItem[] } {
  const items = [...initial];
  return {
    items,
    list: async () => ({ kind: 'ok', value: items }),
    load: async (id) => ({ kind: 'ok', value: items.find((i) => i.id === id) ?? null }),
    upsert: async (item) => {
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      return { kind: 'ok', value: item };
    },
    delete: async () => ({ kind: 'ok', value: undefined }),
  };
}

function canonItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 2,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    ...overrides,
  };
}

describe('deleteAisles', () => {
  it('removes specified aisles from store', async () => {
    const aisleStore = makeAisleStore([
      { id: 'a1', name: 'Produce', order: 0 },
      { id: 'a2', name: 'Dairy', order: 1 },
    ]);
    const canonStore = makeCanonStore();
    const result = await deleteAisles({ ids: ['a1'] }, aisleStore, canonStore);
    expect(result.kind).toBe('ok');
    expect(aisleStore.items).toHaveLength(1);
    expect(aisleStore.items[0].id).toBe('a2');
  });

  it('sets aisleId=null and needs_approval=true on affected canon items', async () => {
    const aisleStore = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const canonStore = makeCanonStore([
      canonItem({ id: 'c1', name: 'Tomato', aisleId: 'a1' }),
      canonItem({ id: 'c2', name: 'Milk', aisleId: 'a2' }),
    ]);
    await deleteAisles({ ids: ['a1'] }, aisleStore, canonStore);
    const tomato = canonStore.items.find((i) => i.id === 'c1')!;
    expect(tomato.aisleId).toBeNull();
    expect(tomato.needs_approval).toBe(true);
    const milk = canonStore.items.find((i) => i.id === 'c2')!;
    expect(milk.aisleId).toBe('a2');
    expect(milk.needs_approval).toBe(false);
  });

  it('propagates aisle store load failure', async () => {
    const store: AisleLocalStorePort = {
      load: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      save: async () => ({ kind: 'ok', value: undefined }),
    };
    const result = await deleteAisles({ ids: ['a1'] }, store, makeCanonStore());
    expect(result.kind).toBe('err');
  });

  it('propagates canon store list failure', async () => {
    const aisleStore = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const canonStore: CanonLocalStorePort = {
      list: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      load: async () => ({ kind: 'ok', value: null }),
      upsert: async (item) => ({ kind: 'ok', value: item }),
      delete: async () => ({ kind: 'ok', value: undefined }),
    };
    const result = await deleteAisles({ ids: ['a1'] }, aisleStore, canonStore);
    expect(result.kind).toBe('err');
  });
});
