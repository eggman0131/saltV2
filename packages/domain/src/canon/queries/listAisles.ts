import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { AisleStorePort } from '../ports/AisleStorePort.js';

export async function listAisles(
  store: AisleStorePort,
): Promise<ReadResult<readonly Aisle[], DomainError>> {
  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const aisles = loadResult.value ?? [];
  return success([...aisles].sort((a, b) => a.order - b.order));
}
