import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface CreateCanonItemInput {
  readonly name: string;
  readonly synonyms?: readonly string[];
  readonly aisleId?: string | null;
  readonly needs_approval?: boolean;
}

export function createCanonItem(
  input: CreateCanonItemInput,
  ids: IdGenerator,
): ReadResult<CanonItem, DomainError> {
  const name = input.name.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_CANON_NAME });
  }
  return success({
    id: ids.newCanonId(),
    schemaVersion: 2,
    name,
    synonyms: (input.synonyms ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
    aisleId: input.aisleId ?? null,
    thumbnail: null,
    embedding: null,
    needs_approval: input.needs_approval ?? true,
    updatedAt: '',
    revision: 0,
    deletedAt: null,
  });
}
