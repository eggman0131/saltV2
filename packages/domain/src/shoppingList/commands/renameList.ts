import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingList } from '../entities/ShoppingList.js';

export interface RenameListInput {
  readonly id: string;
  readonly name: string;
  readonly now: string;
}

export function renameList(
  lists: readonly ShoppingList[],
  input: RenameListInput,
): ReadResult<ShoppingList[], DomainError> {
  const name = input.name.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_LIST_NAME });
  }
  const exists = lists.some((l) => l.id === input.id);
  if (!exists) {
    return failure({ kind: 'NotFound', resource: 'shoppingList', id: input.id });
  }
  return success(lists.map((l) => (l.id === input.id ? { ...l, name, updatedAt: input.now } : l)));
}
