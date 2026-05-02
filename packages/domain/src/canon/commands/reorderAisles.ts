import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { AisleLocalStorePort } from '../ports/AisleLocalStorePort.js';

export interface ReorderAislesInput {
  readonly orderedIds: readonly string[];
}

export async function reorderAisles(
  input: ReorderAislesInput,
  store: AisleLocalStorePort,
): Promise<ReadResult<readonly Aisle[], DomainError>> {
  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const stored = loadResult.value;
  const existing = stored?.aisles ?? [];
  const revision = stored?.revision ?? 0;
  const byId = new Map(existing.map((a) => [a.id, a]));

  const reordered: Aisle[] = [];
  for (const id of input.orderedIds) {
    const aisle = byId.get(id);
    if (aisle) reordered.push({ ...aisle, order: reordered.length });
  }

  // Aisles not present in orderedIds are appended in their original relative order
  const inList = new Set(input.orderedIds);
  let tail = reordered.length;
  for (const aisle of existing) {
    if (!inList.has(aisle.id)) reordered.push({ ...aisle, order: tail++ });
  }

  const saveResult = await store.save(reordered, revision);
  if (saveResult.kind === 'err') return saveResult;

  return success(reordered);
}
