import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'salt-v1';
export const DB_VERSION = 3;

export const CANON_ITEMS_STORE = 'canonItems';
export const SYNC_META_STORE = 'syncMeta';
export const PENDING_WRITES_STORE = 'pendingWrites';
export const AISLES_DATA_STORE = 'aislesData';
export const PENDING_AISLES_SAVE_STORE = 'pendingAislesSave';

export const dbPromise: Promise<IDBPDatabase> = openDB(DB_NAME, DB_VERSION, {
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
    if (oldVersion < 3) {
      if (!db.objectStoreNames.contains(AISLES_DATA_STORE)) {
        db.createObjectStore(AISLES_DATA_STORE);
      }
      if (!db.objectStoreNames.contains(PENDING_AISLES_SAVE_STORE)) {
        db.createObjectStore(PENDING_AISLES_SAVE_STORE);
      }
    }
  },
});
