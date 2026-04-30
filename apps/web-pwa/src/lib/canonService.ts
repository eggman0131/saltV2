import {
  createFirebaseCanonSyncTransportAdapter,
  createGeminiEmbeddingAdapter,
  createGeminiArbitrationAdapter,
} from '@salt/firebase-sync';
import { createLDMatchLoggingAdapter, createLDErrorReportingAdapter } from '@salt/ld-observability';
import {
  matchOrCreate,
  resolveCanonConflict,
  renameCanonItem,
  setCanonItemAisle,
  setCanonItemSynonyms,
} from '@salt/domain';
import type { ConflictStrategy, MatchOrCreateResult } from '@salt/domain';
import { createLocalCanonStoreAdapter } from '@salt/local-store';
import { getLocalAisleStore } from './aisleService.js';
import type {
  CanonItem,
  CanonLocalStorePort,
  CanonSyncTransportPort,
  SyncPending,
} from '@salt/domain';
import type { Conflict, Result, DomainError } from '@salt/shared-types';
export type { MatchOrCreateResult };
import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';

let _localStore: CanonLocalStorePort | null = null;
let _syncTransport: CanonSyncTransportPort | null = null;

const _canonItems = writable<CanonItem[]>([]);
export const canonItems: Readable<CanonItem[]> = _canonItems;

const _syncPending = writable<SyncPending>({ initialSync: false, pull: false, push: false });
export const syncPending: Readable<SyncPending> = _syncPending;

const _canonConflicts = writable<Conflict<CanonItem>[]>([]);
export const canonConflicts: Readable<Conflict<CanonItem>[]> = _canonConflicts;

function getLocalStore(): CanonLocalStorePort {
  if (!_localStore) _localStore = createLocalCanonStoreAdapter();
  return _localStore;
}

function getSyncTransport(): CanonSyncTransportPort {
  if (!_syncTransport)
    _syncTransport = createFirebaseCanonSyncTransportAdapter(createLDErrorReportingAdapter());
  return _syncTransport;
}

export async function refreshCanonItems(): Promise<void> {
  const result = await getLocalStore().list();
  if (result.kind === 'ok') _canonItems.set([...result.value]);
}

function enqueuePush(item: CanonItem): void {
  _syncPending.update((p) => ({ ...p, push: true }));
  void getSyncTransport()
    .push(item)
    .then((r) => {
      if (r.kind === 'conflict') _canonConflicts.update((cs) => [...cs, r]);
    })
    .finally(() => _syncPending.update((p) => ({ ...p, push: false })));
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
  selectedAisleId?: string | null,
  forceCreate?: boolean,
): Promise<Result<MatchOrCreateResult, DomainError>> {
  const errors = createLDErrorReportingAdapter();
  const result = await matchOrCreate(
    { rawName, selectedAisleId, ...(forceCreate !== undefined && { forceCreate }) },
    {
      store: getLocalStore(),
      aisleStore: getLocalAisleStore(),
      embedding: createGeminiEmbeddingAdapter(errors),
      arbitration: createGeminiArbitrationAdapter(errors),
      ids: { newCanonId: () => crypto.randomUUID(), newAisleId: () => crypto.randomUUID() },
      logging: createLDMatchLoggingAdapter(),
    },
  );
  if (result.kind === 'ok') {
    await getLocalStore().enqueuePendingWrite(result.value.item);
    enqueuePush(result.value.item);
    await refreshCanonItems();
  }
  return result;
}

export async function updateCanonItemName(
  item: CanonItem,
  newName: string,
): Promise<Result<CanonItem, DomainError>> {
  const result = renameCanonItem(item, newName);
  if (result.kind === 'ok') {
    await getLocalStore().upsert(result.value);
    enqueuePush(result.value);
    await refreshCanonItems();
  }
  return result;
}

export async function updateCanonItemAisle(
  item: CanonItem,
  aisleId: string | null,
): Promise<Result<CanonItem, DomainError>> {
  const result = setCanonItemAisle(item, aisleId);
  if (result.kind === 'ok') {
    await getLocalStore().upsert(result.value);
    enqueuePush(result.value);
    await refreshCanonItems();
  }
  return result;
}

export async function updateCanonItemSynonyms(
  item: CanonItem,
  synonyms: readonly string[],
): Promise<Result<CanonItem, DomainError>> {
  const result = setCanonItemSynonyms(item, synonyms);
  if (result.kind === 'ok') {
    await getLocalStore().upsert(result.value);
    enqueuePush(result.value);
    await refreshCanonItems();
  }
  return result;
}

export async function deleteCanonItem(id: string): Promise<Result<void, DomainError>> {
  const result = await getLocalStore().delete(id);
  if (result.kind === 'ok') {
    await refreshCanonItems();
  }
  return result;
}

export async function resolveConflict(
  conflict: Conflict<CanonItem>,
  strategy: ConflictStrategy,
): Promise<void> {
  const resolved = resolveCanonConflict(strategy, conflict.local, conflict.remote);
  await getLocalStore().upsert(resolved);
  _canonConflicts.update((cs) => cs.filter((c) => c.local.id !== conflict.local.id));
  enqueuePush(resolved);
  await refreshCanonItems();
}
