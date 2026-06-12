import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface ConfirmItemNeededInput {
  readonly id: string;
  readonly now: string;
}

// Clear an item's verification flag (issue #185): the shopper has confirmed they
// need it, so it stops being highlighted and behaves like any other list item.
// Dropping a flagged item the shopper doesn't need uses deleteItem instead.
export function confirmItemNeeded(
  items: readonly ShoppingListItem[],
  input: ConfirmItemNeededInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const item = items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  return success(
    items.map((i) => (i.id === input.id ? { ...i, needsCheck: false, updatedAt: input.now } : i)),
  );
}
