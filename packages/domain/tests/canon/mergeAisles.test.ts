import { describe, it, expect } from 'vitest';
import { mergeAisles } from '@salt/domain';
import type { AisleStorePort, CanonLocalStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function makeAisleStore(initial: Aisle[] = []): AisleStorePort & { items: Aisle[] } {
  const items = [...initial];
  return {
    items,
    load: async () => ({ kind: 'ok', value: items }),
    save: async (aisles) => {
      items.length = 0;
      items.push(...aisles);
      return { kind: 'ok', value: items };
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

const AISLES = [
  { id: 'target', name: 'Produce', order: 0 },
  { id: 'src1', name: 'Fruits', order: 1 },
  { id: 'src2', name: 'Veggies', order: 2 },
];

describe('mergeAisles', () => {
  it("moves items to target aisle when choice is 'move'", async () => {
    const aisleStore = makeAisleStore(AISLES);
    const canonStore = makeCanonStore([canonItem({ id: 'c1', name: 'Apple', aisleId: 'src1' })]);
    await mergeAisles(
      {
        targetId: 'target',
        sourceIds: ['src1'],
        perItemChoices: [{ canonItemId: 'c1', choice: 'move' }],
      },
      aisleStore,
      canonStore,
    );
    expect(canonStore.items.find((i) => i.id === 'c1')?.aisleId).toBe('target');
    expect(canonStore.items.find((i) => i.id === 'c1')?.needs_approval).toBe(false);
  });

  it("sets aisleId=null and needs_approval=true when choice is 'unassign'", async () => {
    const aisleStore = makeAisleStore(AISLES);
    const canonStore = makeCanonStore([canonItem({ id: 'c1', name: 'Apple', aisleId: 'src1' })]);
    await mergeAisles(
      {
        targetId: 'target',
        sourceIds: ['src1'],
        perItemChoices: [{ canonItemId: 'c1', choice: 'unassign' }],
      },
      aisleStore,
      canonStore,
    );
    expect(canonStore.items.find((i) => i.id === 'c1')?.aisleId).toBeNull();
    expect(canonStore.items.find((i) => i.id === 'c1')?.needs_approval).toBe(true);
  });

  it("defaults to 'unassign' for items not in perItemChoices", async () => {
    const aisleStore = makeAisleStore(AISLES);
    const canonStore = makeCanonStore([canonItem({ id: 'c1', name: 'Apple', aisleId: 'src1' })]);
    await mergeAisles(
      { targetId: 'target', sourceIds: ['src1'], perItemChoices: [] },
      aisleStore,
      canonStore,
    );
    const item = canonStore.items.find((i) => i.id === 'c1')!;
    expect(item.aisleId).toBeNull();
    expect(item.needs_approval).toBe(true);
  });

  it('deletes source aisles and preserves target', async () => {
    const aisleStore = makeAisleStore(AISLES);
    const canonStore = makeCanonStore();
    await mergeAisles(
      { targetId: 'target', sourceIds: ['src1', 'src2'], perItemChoices: [] },
      aisleStore,
      canonStore,
    );
    expect(aisleStore.items.map((a) => a.id)).toEqual(['target']);
  });

  it('leaves items referencing other aisles untouched', async () => {
    const aisleStore = makeAisleStore(AISLES);
    const canonStore = makeCanonStore([
      canonItem({ id: 'c1', name: 'Apple', aisleId: 'src1' }),
      canonItem({ id: 'c2', name: 'Milk', aisleId: 'target' }),
    ]);
    await mergeAisles(
      {
        targetId: 'target',
        sourceIds: ['src1'],
        perItemChoices: [{ canonItemId: 'c1', choice: 'move' }],
      },
      aisleStore,
      canonStore,
    );
    expect(canonStore.items.find((i) => i.id === 'c2')?.aisleId).toBe('target');
  });

  it('propagates canon store list failure', async () => {
    const aisleStore = makeAisleStore(AISLES);
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
    const result = await mergeAisles(
      { targetId: 'target', sourceIds: ['src1'], perItemChoices: [] },
      aisleStore,
      canonStore,
    );
    expect(result.kind).toBe('err');
  });
});
