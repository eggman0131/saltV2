import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { AisleStorePort } from '../ports/AisleStorePort.js';

export interface CreateAislesBulkInput {
  readonly names: readonly string[];
}

export async function createAislesBulk(
  input: CreateAislesBulkInput,
  ids: IdGenerator,
  store: AisleStorePort,
): Promise<ReadResult<readonly Aisle[], DomainError>> {
  const trimmed = input.names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (trimmed.length === 0) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_AISLE_NAME });
  }

  // Deduplicate input (case-insensitive, preserve first occurrence casing)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const name of trimmed) {
    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(name);
    }
  }

  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const existing = loadResult.value ?? [];
  const existingLower = new Set(existing.map((a) => a.name.toLowerCase()));
  const collision = deduped.find((n) => existingLower.has(n.toLowerCase()));
  if (collision !== undefined) {
    return failure({ kind: 'ValidationError', code: ErrorCode.DUPLICATE_AISLE_NAME });
  }

  const maxOrder = existing.reduce((max, a) => Math.max(max, a.order), -1);
  const newAisles: Aisle[] = deduped.map((name, i) => ({
    id: ids.newAisleId(),
    name,
    order: maxOrder + 1 + i,
  }));

  const saveResult = await store.save([...existing, ...newAisles]);
  if (saveResult.kind === 'err') return saveResult;
  if (saveResult.kind === 'conflict') {
    return failure({ kind: 'StorageError', reason: 'unavailable' });
  }

  return success(newAisles);
}
