import { openDB } from 'idb';
import { success, failure } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem, CanonStorePort } from '@salt/domain';

const DB_NAME = 'salt-v1';
const STORE_NAME = 'canonItems';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  },
});

const toError = (): DomainError => ({ kind: 'StorageError', reason: 'unavailable' });

export function createLocalCanonStoreAdapter(): CanonStorePort {
  return {
    async save(item) {
      try {
        const db = await dbPromise;
        await db.put(STORE_NAME, item);
        return success(item);
      } catch {
        return failure(toError());
      }
    },

    async load(id) {
      try {
        const db = await dbPromise;
        const item = ((await db.get(STORE_NAME, id)) as CanonItem | undefined) ?? null;
        return success(item);
      } catch {
        return failure(toError());
      }
    },

    async list() {
      try {
        const db = await dbPromise;
        const items = (await db.getAll(STORE_NAME)) as CanonItem[];
        return success(items);
      } catch {
        return failure(toError());
      }
    },

    async delete(id) {
      try {
        const db = await dbPromise;
        await db.delete(STORE_NAME, id);
        return success(undefined);
      } catch {
        return failure(toError());
      }
    },
  };
}
