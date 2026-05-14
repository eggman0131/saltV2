import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface CheckItemInput {
  readonly id: string;
  readonly now: string;
}

export function checkItem(
  items: readonly ShoppingListItem[],
  input: CheckItemInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const item = items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  return success(
    items.map((i) => (i.id === input.id ? { ...i, checked: true, updatedAt: input.now } : i)),
  );
}
