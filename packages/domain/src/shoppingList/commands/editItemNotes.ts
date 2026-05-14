import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface EditItemNotesInput {
  readonly id: string;
  readonly notes: string;
  readonly now: string;
}

export function editItemNotes(
  items: readonly ShoppingListItem[],
  input: EditItemNotesInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const item = items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  return success(
    items.map((i) =>
      i.id === input.id ? { ...i, notes: input.notes.trim(), updatedAt: input.now } : i,
    ),
  );
}
