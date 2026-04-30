import {
  createFirebaseCanonStoreAdapter,
  createFirebaseAisleStoreAdapter,
  createGeminiEmbeddingAdapter,
  createGeminiArbitrationAdapter,
  subscribeCanonToLocalStore,
} from '@salt/firebase-sync';
import { createLDMatchLoggingAdapter, createLDErrorReportingAdapter } from '@salt/ld-observability';
import { createCanonMatchingPipeline } from '@salt/domain';
import { createLocalCanonStoreAdapter } from '@salt/local-store';
import type { CanonItem } from '@salt/domain';
import type { Result, DomainError } from '@salt/shared-types';
import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';

let _localStore: ReturnType<typeof createLocalCanonStoreAdapter> | null = null;
let _firebaseStore: ReturnType<typeof createFirebaseCanonStoreAdapter> | null = null;
let _pipeline: ReturnType<typeof createCanonMatchingPipeline> | null = null;

const _canonItems = writable<CanonItem[]>([]);
export const canonItems: Readable<CanonItem[]> = _canonItems;

function getLocalStore() {
  if (!_localStore) _localStore = createLocalCanonStoreAdapter();
  return _localStore;
}

function getFirebaseStore() {
  if (!_firebaseStore)
    _firebaseStore = createFirebaseCanonStoreAdapter(createLDErrorReportingAdapter());
  return _firebaseStore;
}

function getPipeline(): ReturnType<typeof createCanonMatchingPipeline> {
  if (!_pipeline) {
    const errors = createLDErrorReportingAdapter();
    _pipeline = createCanonMatchingPipeline(
      getLocalStore(),
      createFirebaseAisleStoreAdapter(errors),
      createGeminiEmbeddingAdapter(errors),
      createGeminiArbitrationAdapter(errors),
      { newCanonId: () => crypto.randomUUID() },
      createLDMatchLoggingAdapter(),
    );
  }
  return _pipeline;
}

async function refreshCanonItems(): Promise<void> {
  const result = await getLocalStore().list();
  if (result.kind === 'ok') _canonItems.set([...result.value]);
}

export function initCanonSync(): () => void {
  refreshCanonItems();
  return subscribeCanonToLocalStore(
    getLocalStore(),
    createLDErrorReportingAdapter(),
    refreshCanonItems,
  );
}

export async function addCanonItem(
  rawName: string,
  selectedAisle?: string | null,
): Promise<Result<CanonItem, DomainError>> {
  const result = await getPipeline().matchOrCreate(rawName, selectedAisle);
  if (result.kind === 'ok') {
    getFirebaseStore().save(result.value); // background push to Firestore
    await refreshCanonItems();
  }
  return result;
}
