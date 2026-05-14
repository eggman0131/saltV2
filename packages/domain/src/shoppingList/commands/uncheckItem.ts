import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface UncheckItemInput {
  readonly id: string;
  readonly now: string;
}

export function uncheckItem(
  items: readonly ShoppingListItem[],
  input: UncheckItemInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const item = items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  return success(
    items.map((i) => (i.id === input.id ? { ...i, checked: false, updatedAt: input.now } : i)),
  );
}
