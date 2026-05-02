import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { createLocalAisleStoreAdapter } from '../src/index.js';
import type { Aisle } from '@salt/domain';

const DB_NAME = 'salt-v1';
const DB_VERSION = 3;
const AISLES_DATA_STORE = 'aislesData';
const PENDING_AISLES_SAVE_STORE = 'pendingAislesSave';

const aisle = (id: string, name: string, order: number): Aisle => ({ id, name, order });

async function clearAll() {
  const db = await openDB(DB_NAME, DB_VERSION);
  await db.clear(AISLES_DATA_STORE);
  await db.clear(PENDING_AISLES_SAVE_STORE);
  db.close();
}

describe('createLocalAisleStoreAdapter', () => {
  beforeEach(async () => {
    await clearAll();
  });

  describe('save / load', () => {
    it('load() returns null when nothing has been saved', async () => {
      const store = createLocalAisleStoreAdapter();
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: null });
    });

    it('save() then load() round-trips aisles and revision', async () => {
      const store = createLocalAisleStoreAdapter();
      const aisles = [aisle('a1', 'Produce', 0), aisle('a2', 'Dairy', 1)];
      await store.save(aisles, 7);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: { aisles, revision: 7 } });
    });

    it('save() returns ok with no payload', async () => {
      const store = createLocalAisleStoreAdapter();
      const result = await store.save([aisle('a1', 'Produce', 0)], 1);
      expect(result).toEqual({ kind: 'ok', value: undefined });
    });

    it('save() overwrites prior aisles and revision', async () => {
      const store = createLocalAisleStoreAdapter();
      await store.save([aisle('a1', 'Produce', 0), aisle('a2', 'Dairy', 1)], 1);
      const next = [aisle('a1', 'Produce', 0)];
      await store.save(next, 2);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: { aisles: next, revision: 2 } });
    });

    it('persists an empty list with its revision', async () => {
      const store = createLocalAisleStoreAdapter();
      await store.save([], 4);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: { aisles: [], revision: 4 } });
    });

    it('preserves aisle ordering across save/load', async () => {
      const store = createLocalAisleStoreAdapter();
      const aisles = [aisle('a3', 'Frozen', 2), aisle('a1', 'Produce', 0), aisle('a2', 'Dairy', 1)];
      await store.save(aisles, 1);
      const result = await store.load();
      expect(result.kind === 'ok' && result.value?.aisles).toEqual(aisles);
    });

    it('two adapters read the same underlying record', async () => {
      const writer = createLocalAisleStoreAdapter();
      const reader = createLocalAisleStoreAdapter();
      await writer.save([aisle('a1', 'Produce', 0)], 3);
      const result = await reader.load();
      expect(result).toEqual({
        kind: 'ok',
        value: { aisles: [aisle('a1', 'Produce', 0)], revision: 3 },
      });
    });
  });

  describe('pending save queue (depth-1)', () => {
    it('drainPendingSave returns null when nothing is queued', async () => {
      const store = createLocalAisleStoreAdapter();
      const result = await store.drainPendingSave();
      expect(result).toEqual({ kind: 'ok', value: null });
    });

    it('enqueue then drain returns the queued aisles and clears', async () => {
      const store = createLocalAisleStoreAdapter();
      const aisles = [aisle('a1', 'Produce', 0)];
      await store.enqueuePendingSave(aisles);
      const drained = await store.drainPendingSave();
      expect(drained).toEqual({ kind: 'ok', value: aisles });
      const second = await store.drainPendingSave();
      expect(second).toEqual({ kind: 'ok', value: null });
    });

    it('repeated enqueue overwrites — only the last payload is drained', async () => {
      const store = createLocalAisleStoreAdapter();
      await store.enqueuePendingSave([aisle('a1', 'first', 0)]);
      await store.enqueuePendingSave([aisle('a2', 'second', 0)]);
      const drained = await store.drainPendingSave();
      expect(drained).toEqual({ kind: 'ok', value: [aisle('a2', 'second', 0)] });
    });

    it('pending queue survives a save() — pending payload is preserved for next push', async () => {
      // Mirrors the canon items invariant: pull replay (save) must not
      // drop the pending payload — it surfaces as a conflict on next push.
      const store = createLocalAisleStoreAdapter();
      await store.enqueuePendingSave([aisle('a1', 'local', 0)]);
      await store.save([aisle('a1', 'remote', 0)], 9);
      const drained = await store.drainPendingSave();
      expect(drained).toEqual({ kind: 'ok', value: [aisle('a1', 'local', 0)] });
    });
  });
});
