import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AisleLocalStorePort } from '../ports/AisleLocalStorePort.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';
import { recordPendingCanonChange } from './recordPendingCanonChange.js';

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

  const existing = loadResult.value ?? [];
  const remaining = existing.filter((a) => !deletedSet.has(a.id));

  const saveResult = await store.save(remaining);
  if (saveResult.kind === 'err') return saveResult;

  const canonResult = await canonStore.list();
  if (canonResult.kind === 'err') return canonResult;

  for (const item of canonResult.value) {
    if (item.aisleId !== null && deletedSet.has(item.aisleId)) {
      // Record why the item was flagged (issue #193): the user deleted its
      // aisle, no AI was involved. `fromAisleId` is read BEFORE the aisle is
      // nulled and names the aisle just deleted — provenance, never display.
      const upsertResult = await canonStore.upsert(
        recordPendingCanonChange(
          { ...item, aisleId: null, needs_approval: true },
          { kind: 'aisle_cleared', fromAisleId: item.aisleId, origin: 'aisle_delete' },
        ),
      );
      if (upsertResult.kind === 'err') return upsertResult;
    }
  }

  return success(undefined);
}
