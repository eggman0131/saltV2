import {
  createFirebaseCanonSyncTransportAdapter,
  createFirebaseAisleStoreAdapter,
  createGeminiEmbeddingAdapter,
  createGeminiArbitrationAdapter,
} from '@salt/firebase-sync';
import { createLDMatchLoggingAdapter, createLDErrorReportingAdapter } from '@salt/ld-observability';
import { matchOrCreate } from '@salt/domain';
import { createLocalCanonStoreAdapter } from '@salt/local-store';
import type {
  CanonItem,
  CanonLocalStorePort,
  CanonSyncTransportPort,
  SyncPending,
} from '@salt/domain';
import type { Result, DomainError } from '@salt/shared-types';
import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';

let _localStore: CanonLocalStorePort | null = null;
let _syncTransport: CanonSyncTransportPort | null = null;

const _canonItems = writable<CanonItem[]>([]);
export const canonItems: Readable<CanonItem[]> = _canonItems;

const _syncPending = writable<SyncPending>({ initialSync: false, pull: false, push: false });
export const syncPending: Readable<SyncPending> = _syncPending;

function getLocalStore(): CanonLocalStorePort {
  if (!_localStore) _localStore = createLocalCanonStoreAdapter();
  return _localStore;
}

function getSyncTransport(): CanonSyncTransportPort {
  if (!_syncTransport)
    _syncTransport = createFirebaseCanonSyncTransportAdapter(createLDErrorReportingAdapter());
  return _syncTransport;
}

async function refreshCanonItems(): Promise<void> {
  const result = await getLocalStore().list();
  if (result.kind === 'ok') _canonItems.set([...result.value]);
}

export function initCanonSync(): () => void {
  _syncPending.update((p) => ({ ...p, initialSync: true }));
  refreshCanonItems();
  let firstBatch = true;
  return getSyncTransport().subscribe(
    ({ upserted, deleted }) => {
      if (firstBatch) {
        firstBatch = false;
        _syncPending.update((p) => ({ ...p, initialSync: false }));
      }
      const store = getLocalStore();
      void Promise.all([
        ...upserted.map((item) => store.upsert(item)),
        ...deleted.map((id) => store.delete(id)),
      ]).then(() => refreshCanonItems());
    },
    (err) => {
      _syncPending.update((p) => ({ ...p, initialSync: false }));
      createLDErrorReportingAdapter().report(err);
    },
  );
}

export async function addCanonItem(
  rawName: string,
  selectedAisle?: string | null,
): Promise<Result<CanonItem, DomainError>> {
  const errors = createLDErrorReportingAdapter();
  const result = await matchOrCreate(
    { rawName, selectedAisle },
    {
      store: getLocalStore(),
      aisleStore: createFirebaseAisleStoreAdapter(errors),
      embedding: createGeminiEmbeddingAdapter(errors),
      arbitration: createGeminiArbitrationAdapter(errors),
      ids: { newCanonId: () => crypto.randomUUID() },
      logging: createLDMatchLoggingAdapter(),
    },
  );
  if (result.kind === 'ok') {
    await getLocalStore().enqueuePendingWrite(result.value);
    _syncPending.update((p) => ({ ...p, push: true }));
    void getSyncTransport()
      .push(result.value)
      .finally(() => _syncPending.update((p) => ({ ...p, push: false })));
    await refreshCanonItems();
  }
  return result;
}
