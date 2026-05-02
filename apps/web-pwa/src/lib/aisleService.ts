// Thin facade over canonService — aisles share the canon manifest sync lifecycle.
// Re-exports the reactive stores and wraps domain commands so each mutation
// enqueues an aisles save through canonService and triggers the drain.
import {
  createAisle,
  createAislesBulk,
  renameAisle as renameAisleCmd,
  reorderAisles as reorderAislesCmd,
  deleteAisles as deleteAislesCmd,
  mergeAisles as mergeAislesCmd,
} from '@salt/domain';
import type { Aisle, MergeAislesInput } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import {
  aisles,
  aisleUsage,
  isLoadingAisles,
  enqueueAisleSave,
  getLocalAisleStore,
  getLocalCanonStore,
  refreshAisles,
} from './canonService.js';

export { aisles, aisleUsage, isLoadingAisles, refreshAisles, getLocalAisleStore };

/**
 * Legacy entry point still imported by route components. The real cold-start
 * and subscribe lifecycle is owned by canonService.initCanonSync; this hook
 * just guarantees the in-memory aisle stores are populated before the first
 * paint of an aisle-aware page.
 */
export async function initAisles(): Promise<void> {
  await refreshAisles();
}

const idGen = { newAisleId: () => crypto.randomUUID(), newCanonId: () => crypto.randomUUID() };

export async function addAisle(name: string): Promise<ReadResult<Aisle, DomainError>> {
  const result = await createAisle({ name }, idGen, getLocalAisleStore());
  if (result.kind === 'ok') await enqueueAisleSave();
  return result;
}

export async function addAislesBulk(
  names: string[],
): Promise<ReadResult<readonly Aisle[], DomainError>> {
  const result = await createAislesBulk({ names }, idGen, getLocalAisleStore());
  if (result.kind === 'ok') await enqueueAisleSave();
  return result;
}

export async function renameAisle(
  id: string,
  newName: string,
): Promise<ReadResult<Aisle, DomainError>> {
  const result = await renameAisleCmd({ id, newName }, getLocalAisleStore());
  if (result.kind === 'ok') await enqueueAisleSave();
  return result;
}

export async function reorderAisles(orderedIds: string[]): Promise<void> {
  await reorderAislesCmd({ orderedIds }, getLocalAisleStore());
  await enqueueAisleSave();
}

export async function deleteAisles(ids: string[]): Promise<ReadResult<void, DomainError>> {
  const result = await deleteAislesCmd({ ids }, getLocalAisleStore(), getLocalCanonStore());
  if (result.kind === 'ok') await enqueueAisleSave();
  return result;
}

export async function mergeAisles(input: MergeAislesInput): Promise<ReadResult<void, DomainError>> {
  const result = await mergeAislesCmd(input, getLocalAisleStore(), getLocalCanonStore());
  if (result.kind === 'ok') await enqueueAisleSave();
  return result;
}
