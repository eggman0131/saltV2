import {
  createAisle,
  createAislesBulk,
  renameAisle as renameAisleCmd,
  reorderAisles as reorderAislesCmd,
  deleteAisles as deleteAislesCmd,
  mergeAisles as mergeAislesCmd,
  listAisles,
  getAisleUsage,
} from '@salt/domain';
import type { Aisle, AisleStorePort, CanonLocalStorePort, MergeAislesInput } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { createLocalAisleStoreAdapter, createLocalCanonStoreAdapter } from '@salt/local-store';
import { createFirebaseAisleStoreAdapter } from '@salt/firebase-sync';
import { createLDErrorReportingAdapter } from '@salt/ld-observability';
import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';

let _localAisleStore: AisleStorePort | null = null;
let _localCanonStore: CanonLocalStorePort | null = null;
let _firebaseAisleStore: AisleStorePort | null = null;

const _aisles = writable<Aisle[]>([]);
export const aisles: Readable<Aisle[]> = _aisles;

const _aisleUsage = writable<Map<string, number>>(new Map());
export const aisleUsage: Readable<Map<string, number>> = _aisleUsage;

const _isLoadingAisles = writable(false);
export const isLoadingAisles: Readable<boolean> = _isLoadingAisles;

export function getLocalAisleStore(): AisleStorePort {
  if (!_localAisleStore) _localAisleStore = createLocalAisleStoreAdapter();
  return _localAisleStore;
}

function getLocalCanonStore(): CanonLocalStorePort {
  if (!_localCanonStore) _localCanonStore = createLocalCanonStoreAdapter();
  return _localCanonStore;
}

function getFirebaseAisleStore(): AisleStorePort {
  if (!_firebaseAisleStore)
    _firebaseAisleStore = createFirebaseAisleStoreAdapter(createLDErrorReportingAdapter());
  return _firebaseAisleStore;
}

async function refreshAisles(): Promise<void> {
  const [aislesResult, usageResult] = await Promise.all([
    listAisles(getLocalAisleStore()),
    getAisleUsage(getLocalAisleStore(), getLocalCanonStore()),
  ]);
  if (aislesResult.kind === 'ok') _aisles.set([...aislesResult.value]);
  if (usageResult.kind === 'ok') _aisleUsage.set(new Map(usageResult.value));
}

function syncToFirebase(): void {
  void (async () => {
    const local = await getLocalAisleStore().load();
    if (local.kind === 'ok' && local.value !== null) {
      await getFirebaseAisleStore().save(local.value);
    }
  })();
}

export async function initAisles(): Promise<void> {
  _isLoadingAisles.set(true);
  await refreshAisles();
  _isLoadingAisles.set(false);
  const remote = await getFirebaseAisleStore().load();
  if (remote.kind === 'ok' && remote.value !== null) {
    await getLocalAisleStore().save(remote.value);
    await refreshAisles();
  }
}

export async function addAisle(name: string): Promise<ReadResult<Aisle, DomainError>> {
  const result = await createAisle(
    { name },
    { newAisleId: () => crypto.randomUUID(), newCanonId: () => crypto.randomUUID() },
    getLocalAisleStore(),
  );
  if (result.kind === 'ok') {
    await refreshAisles();
    syncToFirebase();
  }
  return result;
}

export async function addAislesBulk(
  names: string[],
): Promise<ReadResult<readonly Aisle[], DomainError>> {
  const result = await createAislesBulk(
    { names },
    { newAisleId: () => crypto.randomUUID(), newCanonId: () => crypto.randomUUID() },
    getLocalAisleStore(),
  );
  if (result.kind === 'ok') {
    await refreshAisles();
    syncToFirebase();
  }
  return result;
}

export async function renameAisle(
  id: string,
  newName: string,
): Promise<ReadResult<Aisle, DomainError>> {
  const result = await renameAisleCmd({ id, newName }, getLocalAisleStore());
  if (result.kind === 'ok') {
    await refreshAisles();
    syncToFirebase();
  }
  return result;
}

export async function reorderAisles(orderedIds: string[]): Promise<void> {
  await reorderAislesCmd({ orderedIds }, getLocalAisleStore());
  await refreshAisles();
  syncToFirebase();
}

export async function deleteAisles(ids: string[]): Promise<ReadResult<void, DomainError>> {
  const result = await deleteAislesCmd({ ids }, getLocalAisleStore(), getLocalCanonStore());
  if (result.kind === 'ok') {
    await refreshAisles();
    syncToFirebase();
  }
  return result;
}

export async function mergeAisles(input: MergeAislesInput): Promise<ReadResult<void, DomainError>> {
  const result = await mergeAislesCmd(input, getLocalAisleStore(), getLocalCanonStore());
  if (result.kind === 'ok') {
    await refreshAisles();
    syncToFirebase();
  }
  return result;
}
