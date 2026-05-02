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
import { saveAisles, upsertCanonItem } from '@salt/firebase-sync';
import {
  aisles,
  aisleUsage,
  isLoadingAisles,
  getAislesSnapshot,
  getCanonItemsSnapshot,
  memAisleStore,
  memCanonStore,
} from './canonService.js';

export { aisles, aisleUsage, isLoadingAisles };

const idGen = { newAisleId: () => crypto.randomUUID(), newCanonId: () => crypto.randomUUID() };

export async function addAisle(name: string): Promise<ReadResult<Aisle, DomainError>> {
  const { store, getWritten } = memAisleStore(getAislesSnapshot());
  const result = await createAisle({ name }, idGen, store);
  if (result.kind === 'ok') {
    const newAisles = getWritten();
    if (newAisles !== null) await saveAisles([...newAisles]);
  }
  return result;
}

export async function addAislesBulk(
  names: string[],
): Promise<ReadResult<readonly Aisle[], DomainError>> {
  const { store, getWritten } = memAisleStore(getAislesSnapshot());
  const result = await createAislesBulk({ names }, idGen, store);
  if (result.kind === 'ok') {
    const newAisles = getWritten();
    if (newAisles !== null) await saveAisles([...newAisles]);
  }
  return result;
}

export async function renameAisle(
  id: string,
  newName: string,
): Promise<ReadResult<Aisle, DomainError>> {
  const { store, getWritten } = memAisleStore(getAislesSnapshot());
  const result = await renameAisleCmd({ id, newName }, store);
  if (result.kind === 'ok') {
    const newAisles = getWritten();
    if (newAisles !== null) await saveAisles([...newAisles]);
  }
  return result;
}

export async function reorderAisles(orderedIds: string[]): Promise<void> {
  const { store, getWritten } = memAisleStore(getAislesSnapshot());
  await reorderAislesCmd({ orderedIds }, store);
  const newAisles = getWritten();
  if (newAisles !== null) await saveAisles([...newAisles]);
}

export async function deleteAisles(ids: string[]): Promise<ReadResult<void, DomainError>> {
  const { store: aisleStore, getWritten } = memAisleStore(getAislesSnapshot());
  const { store: canonStore, getUpserted } = memCanonStore(getCanonItemsSnapshot());
  const result = await deleteAislesCmd({ ids }, aisleStore, canonStore);
  if (result.kind === 'ok') {
    const newAisles = getWritten();
    const writes: Promise<void>[] = [];
    if (newAisles !== null) writes.push(saveAisles([...newAisles]));
    for (const item of getUpserted()) writes.push(upsertCanonItem(item));
    await Promise.all(writes);
  }
  return result;
}

export async function mergeAisles(input: MergeAislesInput): Promise<ReadResult<void, DomainError>> {
  const { store: aisleStore, getWritten } = memAisleStore(getAislesSnapshot());
  const { store: canonStore, getUpserted } = memCanonStore(getCanonItemsSnapshot());
  const result = await mergeAislesCmd(input, aisleStore, canonStore);
  if (result.kind === 'ok') {
    const newAisles = getWritten();
    const writes: Promise<void>[] = [];
    if (newAisles !== null) writes.push(saveAisles([...newAisles]));
    for (const item of getUpserted()) writes.push(upsertCanonItem(item));
    await Promise.all(writes);
  }
  return result;
}
