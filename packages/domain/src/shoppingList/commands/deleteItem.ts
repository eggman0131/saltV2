import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface DeleteItemInput {
  readonly id: string;
}

export function deleteItem(
  items: readonly ShoppingListItem[],
  input: DeleteItemInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const exists = items.some((i) => i.id === input.id);
  if (!exists) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  return success(items.filter((i) => i.id !== input.id));
}
