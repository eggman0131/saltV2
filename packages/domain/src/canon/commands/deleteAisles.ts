import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AisleStorePort } from '../ports/AisleStorePort.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';

export interface DeleteAislesInput {
  readonly ids: readonly string[];
}

export async function deleteAisles(
  input: DeleteAislesInput,
  store: AisleStorePort,
  canonStore: CanonLocalStorePort,
): Promise<ReadResult<void, DomainError>> {
  const deletedSet = new Set(input.ids);

  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const existing = loadResult.value ?? [];
  const remaining = existing.filter((a) => !deletedSet.has(a.id));

  const saveResult = await store.save(remaining);
  if (saveResult.kind === 'err') return saveResult;
  if (saveResult.kind === 'conflict') {
    return failure({ kind: 'StorageError', reason: 'unavailable' });
  }

  const canonResult = await canonStore.list();
  if (canonResult.kind === 'err') return canonResult;

  for (const item of canonResult.value) {
    if (item.aisleId !== null && deletedSet.has(item.aisleId)) {
      const upsertResult = await canonStore.upsert({
        ...item,
        aisleId: null,
        needs_approval: true,
      });
      if (upsertResult.kind === 'err') return upsertResult;
    }
  }

  return success(undefined);
}
