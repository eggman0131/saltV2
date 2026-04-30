import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AisleStorePort } from '../ports/AisleStorePort.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';

export type ItemMergeChoice = 'move' | 'unassign';

export interface PerItemMergeChoice {
  readonly canonItemId: string;
  readonly choice: ItemMergeChoice;
}

export interface MergeAislesInput {
  readonly targetId: string;
  readonly sourceIds: readonly string[];
  readonly perItemChoices: readonly PerItemMergeChoice[];
}

export async function mergeAisles(
  input: MergeAislesInput,
  store: AisleStorePort,
  canonStore: CanonLocalStorePort,
): Promise<ReadResult<void, DomainError>> {
  const sourceSet = new Set(input.sourceIds);
  const choiceMap = new Map(input.perItemChoices.map((c) => [c.canonItemId, c.choice]));

  // Apply per-item choices; items not in choiceMap default to 'unassign'
  const canonResult = await canonStore.list();
  if (canonResult.kind === 'err') return canonResult;

  for (const item of canonResult.value) {
    if (item.aisleId === null || !sourceSet.has(item.aisleId)) continue;
    const choice = choiceMap.get(item.id) ?? 'unassign';
    const updated =
      choice === 'move'
        ? { ...item, aisleId: input.targetId }
        : { ...item, aisleId: null, needs_approval: true };
    const upsertResult = await canonStore.upsert(updated);
    if (upsertResult.kind === 'err') return upsertResult;
  }

  // Delete source aisles
  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const remaining = (loadResult.value ?? []).filter((a) => !sourceSet.has(a.id));
  const saveResult = await store.save(remaining);
  if (saveResult.kind === 'err') return saveResult;
  if (saveResult.kind === 'conflict') {
    return failure({ kind: 'StorageError', reason: 'unavailable' });
  }

  return success(undefined);
}
