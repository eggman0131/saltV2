import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { AisleStorePort } from '../ports/AisleStorePort.js';

export interface RenameAisleInput {
  readonly id: string;
  readonly newName: string;
}

export async function renameAisle(
  input: RenameAisleInput,
  store: AisleStorePort,
): Promise<ReadResult<Aisle, DomainError>> {
  const newName = input.newName.trim();
  if (!newName) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_AISLE_NAME });
  }

  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const existing = loadResult.value ?? [];
  const target = existing.find((a) => a.id === input.id);
  if (!target) {
    return failure({ kind: 'NotFound', resource: 'aisle', id: input.id });
  }

  const nameLower = newName.toLowerCase();
  if (existing.some((a) => a.id !== input.id && a.name.toLowerCase() === nameLower)) {
    return failure({ kind: 'ValidationError', code: ErrorCode.DUPLICATE_AISLE_NAME });
  }

  const renamed: Aisle = { ...target, name: newName };
  const updated = existing.map((a) => (a.id === input.id ? renamed : a));

  const saveResult = await store.save(updated);
  if (saveResult.kind === 'err') return saveResult;
  if (saveResult.kind === 'conflict') {
    return failure({ kind: 'StorageError', reason: 'unavailable' });
  }

  return success(renamed);
}
