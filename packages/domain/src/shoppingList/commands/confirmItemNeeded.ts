import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { setItemNeedsCheck } from './setItemNeedsCheck.js';

export interface ConfirmItemNeededInput {
  readonly id: string;
  readonly now: string;
}

// Clear an item's verification flag (issue #185): the shopper has confirmed they
// need it, so it stops being highlighted and behaves like any other list item.
// Dropping a flagged item the shopper doesn't need uses deleteItem instead.
// The named half of the two-way setItemNeedsCheck transition — one implementation.
export function confirmItemNeeded(
  items: readonly ShoppingListItem[],
  input: ConfirmItemNeededInput,
): ReadResult<ShoppingListItem[], DomainError> {
  return setItemNeedsCheck(items, { id: input.id, needsCheck: false, now: input.now });
}
