import { openDB } from 'idb';
import { success, failure } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem, CanonLocalStorePort } from '@salt/domain';

const DB_NAME = 'salt-v1';
const DB_VERSION = 2;
const CANON_ITEMS_STORE = 'canonItems';
const SYNC_META_STORE = 'syncMeta';
const PENDING_WRITES_STORE = 'pendingWrites';

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (!db.objectStoreNames.contains(CANON_ITEMS_STORE)) {
      db.createObjectStore(CANON_ITEMS_STORE, { keyPath: 'id' });
    }
    if (oldVersion < 2) {
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
        db.createObjectStore(SYNC_META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(PENDING_WRITES_STORE)) {
        db.createObjectStore(PENDING_WRITES_STORE, { keyPath: 'id' });
      }
    }
  },
});

const toError = (): DomainError => ({ kind: 'StorageError', reason: 'unavailable' });

export function createLocalCanonStoreAdapter(): CanonLocalStorePort {
  return {
    async upsert(item) {
      try {
        const db = await dbPromise;
        await db.put(CANON_ITEMS_STORE, item);
        return success(item);
      } catch {
        return failure(toError());
      }
    },

    async load(id) {
      try {
        const db = await dbPromise;
        const item = ((await db.get(CANON_ITEMS_STORE, id)) as CanonItem | undefined) ?? null;
        return success(item);
      } catch {
        return failure(toError());
      }
    },

    async list() {
      try {
        const db = await dbPromise;
        const items = (await db.getAll(CANON_ITEMS_STORE)) as CanonItem[];
        return success(items);
      } catch {
        return failure(toError());
      }
    },

    async delete(id) {
      try {
        const db = await dbPromise;
        await db.delete(CANON_ITEMS_STORE, id);
        return success(undefined);
      } catch {
        return failure(toError());
      }
    },

    async getManifestCursor() {
      try {
        const db = await dbPromise;
        const record = (await db.get(SYNC_META_STORE, 'manifestCursor')) as
          | { key: string; value: string }
          | undefined;
        return success(record?.value ?? null);
      } catch {
        return failure(toError());
      }
    },

    async setManifestCursor(cursor) {
      try {
        const db = await dbPromise;
        await db.put(SYNC_META_STORE, { key: 'manifestCursor', value: cursor });
        return success(undefined);
      } catch {
        return failure(toError());
      }
    },

    async enqueuePendingWrite(item) {
      try {
        const db = await dbPromise;
        await db.put(PENDING_WRITES_STORE, item);
        return success(undefined);
      } catch {
        return failure(toError());
      }
    },

    async drainPendingWrites() {
      try {
        const db = await dbPromise;
        const tx = db.transaction(PENDING_WRITES_STORE, 'readwrite');
        const items = (await tx.store.getAll()) as CanonItem[];
        await tx.store.clear();
        await tx.done;
        return success(items);
      } catch {
        return failure(toError());
      }
    },
  };
}
