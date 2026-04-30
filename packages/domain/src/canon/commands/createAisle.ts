import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { AisleStorePort } from '../ports/AisleStorePort.js';

export interface CreateAisleInput {
  readonly name: string;
}

export async function createAisle(
  input: CreateAisleInput,
  ids: IdGenerator,
  store: AisleStorePort,
): Promise<ReadResult<Aisle, DomainError>> {
  const name = input.name.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_AISLE_NAME });
  }

  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const existing = loadResult.value ?? [];
  const nameLower = name.toLowerCase();
  if (existing.some((a) => a.name.toLowerCase() === nameLower)) {
    return failure({ kind: 'ValidationError', code: ErrorCode.DUPLICATE_AISLE_NAME });
  }

  const maxOrder = existing.reduce((max, a) => Math.max(max, a.order), -1);
  const newAisle: Aisle = { id: ids.newAisleId(), name, order: maxOrder + 1 };

  const saveResult = await store.save([...existing, newAisle]);
  if (saveResult.kind === 'err') return saveResult;
  if (saveResult.kind === 'conflict') {
    return failure({ kind: 'StorageError', reason: 'unavailable' });
  }

  return success(newAisle);
}
