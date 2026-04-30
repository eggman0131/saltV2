import { openDB } from 'idb';
import { success, failure } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { Aisle, AisleStorePort } from '@salt/domain';

const DB_NAME = 'salt-aisles-v1';
const DB_VERSION = 1;
const STORE = 'aisleList';
const DOC_KEY = 'data';

interface AisleListDoc {
  aisles: Aisle[];
  schemaVersion: 1;
}

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    db.createObjectStore(STORE);
  },
});

const toError = (): DomainError => ({ kind: 'StorageError', reason: 'unavailable' });

export function createLocalAisleStoreAdapter(): AisleStorePort {
  return {
    async load() {
      try {
        const db = await dbPromise;
        const record = (await db.get(STORE, DOC_KEY)) as AisleListDoc | undefined;
        return success(record?.aisles ?? null);
      } catch {
        return failure(toError());
      }
    },

    async save(aisles) {
      try {
        const db = await dbPromise;
        const doc: AisleListDoc = { aisles: [...aisles], schemaVersion: 1 };
        await db.put(STORE, doc, DOC_KEY);
        return success(aisles);
      } catch {
        return failure(toError());
      }
    },
  };
}
