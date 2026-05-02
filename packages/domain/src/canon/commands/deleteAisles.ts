import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AisleLocalStorePort } from '../ports/AisleLocalStorePort.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';

export interface DeleteAislesInput {
  readonly ids: readonly string[];
}

export async function deleteAisles(
  input: DeleteAislesInput,
  store: AisleLocalStorePort,
  canonStore: CanonLocalStorePort,
): Promise<ReadResult<void, DomainError>> {
  const deletedSet = new Set(input.ids);

  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const stored = loadResult.value;
  const existing = stored?.aisles ?? [];
  const revision = stored?.revision ?? 0;
  const remaining = existing.filter((a) => !deletedSet.has(a.id));

  const saveResult = await store.save(remaining, revision);
  if (saveResult.kind === 'err') return saveResult;

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
