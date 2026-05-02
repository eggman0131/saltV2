import { success, failure } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem, CanonLocalStorePort, CursorScope } from '@salt/domain';
import {
  dbPromise,
  CANON_ITEMS_STORE,
  SYNC_META_STORE,
  PENDING_WRITES_STORE,
} from './db.js';

const cursorKey = (scope: CursorScope): string => `manifestCursor:${scope}`;

const toError = (): DomainError => ({ kind: 'StorageError', reason: 'unavailable' });

interface CursorRecord {
  readonly key: string;
  readonly value: number;
}

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
        return success(items.filter((i) => i.deletedAt === null));
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

    async getCursor(scope) {
      try {
        const db = await dbPromise;
        const record = (await db.get(SYNC_META_STORE, cursorKey(scope))) as
          | CursorRecord
          | undefined;
        return success(record?.value ?? null);
      } catch {
        return failure(toError());
      }
    },

    async setCursor(scope, value) {
      try {
        const db = await dbPromise;
        const record: CursorRecord = { key: cursorKey(scope), value };
        await db.put(SYNC_META_STORE, record);
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
