import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { createLocalCanonStoreAdapter } from '../src/index.js';
import type { CanonItem } from '@salt/domain';

const DB_NAME = 'salt-v1';
const DB_VERSION = 3;
const CANON_ITEMS_STORE = 'canonItems';
const SYNC_META_STORE = 'syncMeta';
const PENDING_WRITES_STORE = 'pendingWrites';

function item(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'c1',
    schemaVersion: 2,
    name: 'Olive Oil',
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '2026-05-01T00:00:00.000Z',
    revision: 1,
    deletedAt: null,
    ...overrides,
  };
}

async function clearAll() {
  const db = await openDB(DB_NAME, DB_VERSION);
  await db.clear(CANON_ITEMS_STORE);
  await db.clear(SYNC_META_STORE);
  await db.clear(PENDING_WRITES_STORE);
  db.close();
}

describe('createLocalCanonStoreAdapter', () => {
  beforeEach(async () => {
    await clearAll();
  });

  describe('upsert / load / delete', () => {
    it('round-trips an item', async () => {
      const store = createLocalCanonStoreAdapter();
      const a = item({ id: 'a1', name: 'Apple' });
      await store.upsert(a);
      const result = await store.load('a1');
      expect(result).toEqual({ kind: 'ok', value: a });
    });

    it('load() returns null for unknown id', async () => {
      const store = createLocalCanonStoreAdapter();
      const result = await store.load('missing');
      expect(result).toEqual({ kind: 'ok', value: null });
    });

    it('upsert() overwrites by id (idempotent on monotonic revision)', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.upsert(item({ id: 'a1', name: 'Apple', revision: 1 }));
      const updated = item({ id: 'a1', name: 'Apple Red', revision: 2 });
      await store.upsert(updated);
      const result = await store.load('a1');
      expect(result).toEqual({ kind: 'ok', value: updated });
    });

    it('delete() removes the item', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.upsert(item({ id: 'a1' }));
      await store.delete('a1');
      const result = await store.load('a1');
      expect(result).toEqual({ kind: 'ok', value: null });
    });
  });

  describe('list() tombstone filtering', () => {
    it('excludes items with deletedAt set', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.upsert(item({ id: 'live1', name: 'Apple', deletedAt: null }));
      await store.upsert(
        item({ id: 'dead1', name: 'Pear', deletedAt: '2026-05-01T00:00:00.000Z' }),
      );
      await store.upsert(item({ id: 'live2', name: 'Banana', deletedAt: null }));
      const result = await store.list();
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      const ids = [...result.value].map((i) => i.id).sort();
      expect(ids).toEqual(['live1', 'live2']);
    });

    it('upsert() persists tombstones (deletedAt intact for pull replay)', async () => {
      const store = createLocalCanonStoreAdapter();
      const tombstone = item({
        id: 'dead1',
        name: 'Pear',
        deletedAt: '2026-05-01T00:00:00.000Z',
      });
      await store.upsert(tombstone);
      const result = await store.load('dead1');
      expect(result).toEqual({ kind: 'ok', value: tombstone });
    });

    it('list() returns empty array when only tombstones exist', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.upsert(item({ id: 'dead1', deletedAt: '2026-05-01T00:00:00.000Z' }));
      const result = await store.list();
      expect(result).toEqual({ kind: 'ok', value: [] });
    });
  });

  describe('cursors per scope', () => {
    it('getCursor returns null when never set', async () => {
      const store = createLocalCanonStoreAdapter();
      expect(await store.getCursor('items')).toEqual({ kind: 'ok', value: null });
      expect(await store.getCursor('aisles')).toEqual({ kind: 'ok', value: null });
    });

    it('setCursor / getCursor round-trip per scope', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.setCursor('items', 7);
      await store.setCursor('aisles', 3);
      expect(await store.getCursor('items')).toEqual({ kind: 'ok', value: 7 });
      expect(await store.getCursor('aisles')).toEqual({ kind: 'ok', value: 3 });
    });

    it('scopes are isolated — items cursor does not affect aisles cursor', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.setCursor('items', 42);
      expect(await store.getCursor('aisles')).toEqual({ kind: 'ok', value: null });
    });

    it('cursors persist across adapter reopens', async () => {
      const writer = createLocalCanonStoreAdapter();
      await writer.setCursor('items', 10);
      await writer.setCursor('aisles', 5);
      const reader = createLocalCanonStoreAdapter();
      expect(await reader.getCursor('items')).toEqual({ kind: 'ok', value: 10 });
      expect(await reader.getCursor('aisles')).toEqual({ kind: 'ok', value: 5 });
    });

    it('setCursor overwrites prior value for the same scope', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.setCursor('items', 1);
      await store.setCursor('items', 9);
      expect(await store.getCursor('items')).toEqual({ kind: 'ok', value: 9 });
    });
  });

  describe('pending writes queue', () => {
    it('drainPendingWrites returns [] when nothing is queued', async () => {
      const store = createLocalCanonStoreAdapter();
      const result = await store.drainPendingWrites();
      expect(result).toEqual({ kind: 'ok', value: [] });
    });

    it('enqueue then drain returns queued items and clears the queue', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.enqueuePendingWrite(item({ id: 'p1' }));
      await store.enqueuePendingWrite(item({ id: 'p2' }));
      const drained = await store.drainPendingWrites();
      expect(drained.kind).toBe('ok');
      if (drained.kind !== 'ok') return;
      const ids = drained.value.map((i) => i.id).sort();
      expect(ids).toEqual(['p1', 'p2']);
      const second = await store.drainPendingWrites();
      expect(second).toEqual({ kind: 'ok', value: [] });
    });

    it('coalesces repeated enqueues for the same id (last write wins)', async () => {
      const store = createLocalCanonStoreAdapter();
      await store.enqueuePendingWrite(item({ id: 'p1', name: 'first' }));
      await store.enqueuePendingWrite(item({ id: 'p1', name: 'second' }));
      const drained = await store.drainPendingWrites();
      expect(drained.kind).toBe('ok');
      if (drained.kind !== 'ok') return;
      expect(drained.value).toHaveLength(1);
      expect(drained.value[0]?.name).toBe('second');
    });

    it('pending queue is independent of the items store (survives upsert)', async () => {
      // Pull replay (upsert) must not drop pending writes — they become
      // conflicts on next push if remote has a higher revision.
      const store = createLocalCanonStoreAdapter();
      await store.enqueuePendingWrite(item({ id: 'p1', revision: 1 }));
      await store.upsert(item({ id: 'p1', revision: 5, name: 'remote' }));
      const drained = await store.drainPendingWrites();
      expect(drained.kind).toBe('ok');
      if (drained.kind !== 'ok') return;
      expect(drained.value).toHaveLength(1);
      expect(drained.value[0]?.revision).toBe(1);
    });
  });
});
