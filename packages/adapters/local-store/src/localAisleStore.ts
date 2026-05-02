import { success, failure } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { Aisle, AisleLocalStorePort } from '@salt/domain';
import { dbPromise, AISLES_DATA_STORE, PENDING_AISLES_SAVE_STORE } from './db.js';

const DATA_KEY = 'data';
const PENDING_KEY = 'data';

interface AislesRecord {
  readonly aisles: readonly Aisle[];
  readonly revision: number;
}

interface PendingAislesRecord {
  readonly aisles: readonly Aisle[];
}

const toError = (): DomainError => ({ kind: 'StorageError', reason: 'unavailable' });

export function createLocalAisleStoreAdapter(): AisleLocalStorePort {
  return {
    async save(aisles, revision) {
      try {
        const db = await dbPromise;
        const record: AislesRecord = { aisles: [...aisles], revision };
        await db.put(AISLES_DATA_STORE, record, DATA_KEY);
        return success(undefined);
      } catch {
        return failure(toError());
      }
    },

    async load() {
      try {
        const db = await dbPromise;
        const record = (await db.get(AISLES_DATA_STORE, DATA_KEY)) as AislesRecord | undefined;
        return success(record ? { aisles: record.aisles, revision: record.revision } : null);
      } catch {
        return failure(toError());
      }
    },

    async enqueuePendingSave(aisles) {
      try {
        const db = await dbPromise;
        const record: PendingAislesRecord = { aisles: [...aisles] };
        await db.put(PENDING_AISLES_SAVE_STORE, record, PENDING_KEY);
        return success(undefined);
      } catch {
        return failure(toError());
      }
    },

    async drainPendingSave() {
      try {
        const db = await dbPromise;
        const tx = db.transaction(PENDING_AISLES_SAVE_STORE, 'readwrite');
        const record = (await tx.store.get(PENDING_KEY)) as PendingAislesRecord | undefined;
        await tx.store.delete(PENDING_KEY);
        await tx.done;
        return success(record ? record.aisles : null);
      } catch {
        return failure(toError());
      }
    },
  };
}
