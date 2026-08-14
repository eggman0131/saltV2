import { describe, it, expect } from 'vitest';
import { mergeAisles } from '@salt/domain';
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

  // Issue #193, Phase 2: the flag the user caused themselves. Without this the
  // item sits in the review queue looking like an AI decision.
  describe('pending change record', () => {
    it("records aisle_cleared with origin 'aisle_merge' on the unassign path", async () => {
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
      expect(canonStore.items.find((i) => i.id === 'c1')?.pendingChanges).toEqual([
        { kind: 'aisle_cleared', fromAisleId: 'src1', origin: 'aisle_merge' },
      ]);
    });

    it("records nothing on the 'move' path — a filed item needs no review", async () => {
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
      expect(canonStore.items.find((i) => i.id === 'c1')?.pendingChanges).toBeUndefined();
    });

    it("records on the default (no choice given) path too — it is an 'unassign'", async () => {
      const aisleStore = makeAisleStore(AISLES);
      const canonStore = makeCanonStore([canonItem({ id: 'c1', name: 'Apple', aisleId: 'src2' })]);
      await mergeAisles(
        { targetId: 'target', sourceIds: ['src2'], perItemChoices: [] },
        aisleStore,
        canonStore,
      );
      expect(canonStore.items.find((i) => i.id === 'c1')?.pendingChanges).toEqual([
        { kind: 'aisle_cleared', fromAisleId: 'src2', origin: 'aisle_merge' },
      ]);
    });

    it('appends to changes already waiting, most recent last', async () => {
      const aisleStore = makeAisleStore(AISLES);
      const canonStore = makeCanonStore([
        canonItem({
          id: 'c1',
          name: 'Apple',
          aisleId: 'src1',
          needs_approval: true,
          pendingChanges: [{ kind: 'synonym_added', synonym: 'braeburn' }],
        }),
      ]);
      await mergeAisles(
        { targetId: 'target', sourceIds: ['src1'], perItemChoices: [] },
        aisleStore,
        canonStore,
      );
      expect(canonStore.items.find((i) => i.id === 'c1')?.pendingChanges).toEqual([
        { kind: 'synonym_added', synonym: 'braeburn' },
        { kind: 'aisle_cleared', fromAisleId: 'src1', origin: 'aisle_merge' },
      ]);
    });

    it('leaves items in other aisles with no record at all', async () => {
      const aisleStore = makeAisleStore(AISLES);
      const canonStore = makeCanonStore([
        canonItem({ id: 'c1', name: 'Apple', aisleId: 'src1' }),
        canonItem({ id: 'c2', name: 'Milk', aisleId: 'target' }),
      ]);
      await mergeAisles(
        { targetId: 'target', sourceIds: ['src1'], perItemChoices: [] },
        aisleStore,
        canonStore,
      );
      expect(canonStore.items.find((i) => i.id === 'c2')?.pendingChanges).toBeUndefined();
    });
  });

  it('propagates canon store list failure', async () => {
    const aisleStore = makeAisleStore(AISLES);
    const canonStore: CanonLocalStorePort = {
      list: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      load: async () => ({ kind: 'ok', value: null }),
      upsert: async (item) => ({ kind: 'ok', value: item }),
      delete: async () => ({ kind: 'ok', value: undefined }),
    };
    const result = await mergeAisles(
      { targetId: 'target', sourceIds: ['src1'], perItemChoices: [] },
      aisleStore,
      canonStore,
    );
    expect(result.kind).toBe('err');
  });
});
