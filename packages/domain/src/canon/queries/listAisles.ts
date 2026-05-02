import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { AisleLocalStorePort } from '../ports/AisleLocalStorePort.js';

export async function listAisles(
  store: AisleLocalStorePort,
): Promise<ReadResult<readonly Aisle[], DomainError>> {
  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const aisles = loadResult.value?.aisles ?? [];
  return success([...aisles].sort((a, b) => a.order - b.order));
}
