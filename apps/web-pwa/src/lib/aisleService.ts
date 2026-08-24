import {
  createAisle,
  createAislesBulk,
  renameAisle as renameAisleCmd,
  reorderAisles as reorderAislesCmd,
  deleteAisles as deleteAislesCmd,
  mergeAisles as mergeAislesCmd,
} from '@salt/domain';
import type { Aisle, MergeAislesInput } from '@salt/domain';
import { success, type DomainError, type ReadResult } from '@salt/shared-types';
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
    if (newAisles !== null) {
      const written = await saveAisles([...newAisles]);
      if (written.kind === 'err') return written;
    }
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
    if (newAisles !== null) {
      const written = await saveAisles([...newAisles]);
      if (written.kind === 'err') return written;
    }
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
    if (newAisles !== null) {
      const written = await saveAisles([...newAisles]);
      if (written.kind === 'err') return written;
    }
  }
  return result;
}

export async function reorderAisles(orderedIds: string[]): Promise<ReadResult<void, DomainError>> {
  const { store, getWritten } = memAisleStore(getAislesSnapshot());
  await reorderAislesCmd({ orderedIds }, store);
  const newAisles = getWritten();
  if (newAisles === null) return success(undefined);
  return saveAisles([...newAisles]);
}

export async function deleteAisles(ids: string[]): Promise<ReadResult<void, DomainError>> {
  const { store: aisleStore, getWritten } = memAisleStore(getAislesSnapshot());
  const { store: canonStore, getUpserted } = memCanonStore(getCanonItemsSnapshot());
  const result = await deleteAislesCmd({ ids }, aisleStore, canonStore);
  if (result.kind === 'ok') {
    const newAisles = getWritten();
    const writes: Promise<ReadResult<void, DomainError>>[] = [];
    if (newAisles !== null) writes.push(saveAisles([...newAisles]));
    for (const item of getUpserted()) writes.push(upsertCanonItem(item));
    // Every write is still issued — this is a fan-out, and abandoning the rest
    // on the first refusal would leave the aisles and the canon items that
    // pointed at them disagreeing. The first failure is what the caller hears.
    const failed = (await Promise.all(writes)).find((w) => w.kind === 'err');
    if (failed) return failed;
  }
  return result;
}

export async function mergeAisles(input: MergeAislesInput): Promise<ReadResult<void, DomainError>> {
  const { store: aisleStore, getWritten } = memAisleStore(getAislesSnapshot());
  const { store: canonStore, getUpserted } = memCanonStore(getCanonItemsSnapshot());
  const result = await mergeAislesCmd(input, aisleStore, canonStore);
  if (result.kind === 'ok') {
    const newAisles = getWritten();
    const writes: Promise<ReadResult<void, DomainError>>[] = [];
    if (newAisles !== null) writes.push(saveAisles([...newAisles]));
    for (const item of getUpserted()) writes.push(upsertCanonItem(item));
    // Every write is still issued — this is a fan-out, and abandoning the rest
    // on the first refusal would leave the aisles and the canon items that
    // pointed at them disagreeing. The first failure is what the caller hears.
    const failed = (await Promise.all(writes)).find((w) => w.kind === 'err');
    if (failed) return failed;
  }
  return result;
}
