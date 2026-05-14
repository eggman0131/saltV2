import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingList } from '../entities/ShoppingList.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface CreateListInput {
  readonly name: string;
  readonly now: string;
}

export function createList(
  input: CreateListInput,
  ids: IdGenerator,
): ReadResult<ShoppingList, DomainError> {
  const name = input.name.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_LIST_NAME });
  }
  return success({
    id: ids.newListId(),
    name,
    schemaVersion: 1 as const,
    createdAt: input.now,
    updatedAt: input.now,
  });
}
