import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingList } from '../entities/ShoppingList.js';
import type { ShoppingListsConfig } from '../entities/ShoppingListsConfig.js';

export interface DeleteListInput {
  readonly id: string;
}

export function deleteList(
  lists: readonly ShoppingList[],
  config: ShoppingListsConfig,
  input: DeleteListInput,
): ReadResult<ShoppingList[], DomainError> {
  if (config.defaultListId === input.id) {
    return failure({ kind: 'ValidationError', code: ErrorCode.LIST_IS_DEFAULT });
  }
  const exists = lists.some((l) => l.id === input.id);
  if (!exists) {
    return failure({ kind: 'NotFound', resource: 'shoppingList', id: input.id });
  }
  return success(lists.filter((l) => l.id !== input.id));
}
