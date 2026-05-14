import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingList } from '../entities/ShoppingList.js';
import type { ShoppingListsConfig } from '../entities/ShoppingListsConfig.js';

export interface SetDefaultListInput {
  readonly listId: string;
}

export function setDefaultList(
  lists: readonly ShoppingList[],
  config: ShoppingListsConfig,
  input: SetDefaultListInput,
): ReadResult<ShoppingListsConfig, DomainError> {
  const exists = lists.some((l) => l.id === input.listId);
  if (!exists) {
    return failure({ kind: 'NotFound', resource: 'shoppingList', id: input.listId });
  }
  return success({ ...config, defaultListId: input.listId });
}
