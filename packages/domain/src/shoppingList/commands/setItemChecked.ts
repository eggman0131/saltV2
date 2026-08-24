import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { updateListItem } from './updateListItem.js';

export interface SetItemCheckedInput {
  readonly id: string;
  readonly checked: boolean;
  readonly now: string;
}

// Tick an item off in the aisle, or put it back. One two-way transition rather
// than a `checkItem`/`uncheckItem` pair that differed by a single boolean
// (issue #924) — the same shape `setItemNeedsCheck` already uses for the other
// flag on this item. `checked` is its own axis: not `needsCheck` (the amber
// "Need it?" prompt) and not `matchState` (the canon-matching lifecycle).
export function setItemChecked(
  items: readonly ShoppingListItem[],
  input: SetItemCheckedInput,
): ReadResult<ShoppingListItem[], DomainError> {
  return updateListItem(items, input.id, input.now, (item) =>
    success({ ...item, checked: input.checked }),
  );
}
