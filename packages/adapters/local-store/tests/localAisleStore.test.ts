import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { createLocalAisleStoreAdapter } from '../src/index.js';
import type { Aisle } from '@salt/domain';

const DB_NAME = 'salt-aisles-v1';
const STORE = 'aisleList';

async function clearStore() {
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE);
  db.close();
}

const aisle = (id: string, name: string, order: number): Aisle => ({ id, name, order });

describe('createLocalAisleStoreAdapter', () => {
  beforeEach(async () => {
    await clearStore();
  });

  describe('load()', () => {
    it('returns null when nothing has been saved', async () => {
      const store = createLocalAisleStoreAdapter();
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: null });
    });

    it('returns the saved aisles after a save', async () => {
      const store = createLocalAisleStoreAdapter();
      const aisles = [aisle('a1', 'Produce', 0), aisle('a2', 'Dairy', 1)];
      await store.save(aisles);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: aisles });
    });
  });

  describe('save()', () => {
    it('returns the saved aisle list on success', async () => {
      const store = createLocalAisleStoreAdapter();
      const aisles = [aisle('a1', 'Produce', 0)];
      const result = await store.save(aisles);
      expect(result).toEqual({ kind: 'ok', value: aisles });
    });

    it('overwrites the previous list on a second save', async () => {
      const store = createLocalAisleStoreAdapter();
      await store.save([aisle('a1', 'Produce', 0), aisle('a2', 'Dairy', 1)]);
      const updated = [aisle('a1', 'Produce', 0)];
      await store.save(updated);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: updated });
    });

    it('persists an empty list', async () => {
      const store = createLocalAisleStoreAdapter();
      await store.save([]);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('does not mutate a readonly input array', async () => {
      const store = createLocalAisleStoreAdapter();
      const aisles: readonly Aisle[] = [aisle('a1', 'Produce', 0)];
      await store.save(aisles);
      const result = await store.load();
      expect(result.kind === 'ok' && result.value).toEqual([aisle('a1', 'Produce', 0)]);
    });
  });

  describe('round-trip ordering', () => {
    it('preserves insertion order across save/load', async () => {
      const store = createLocalAisleStoreAdapter();
      const aisles = [aisle('a3', 'Frozen', 2), aisle('a1', 'Produce', 0), aisle('a2', 'Dairy', 1)];
      await store.save(aisles);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: aisles });
    });
  });

  describe('multiple adapter instances', () => {
    it('two adapters read the same underlying data', async () => {
      const writer = createLocalAisleStoreAdapter();
      const reader = createLocalAisleStoreAdapter();
      const aisles = [aisle('a1', 'Produce', 0)];
      await writer.save(aisles);
      const result = await reader.load();
      expect(result).toEqual({ kind: 'ok', value: aisles });
    });
  });
});
