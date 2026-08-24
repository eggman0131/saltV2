import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { updateListItem } from './updateListItem.js';

export interface EditItemNotesInput {
  readonly id: string;
  readonly notes: string;
  readonly now: string;
}

export function editItemNotes(
  items: readonly ShoppingListItem[],
  input: EditItemNotesInput,
): ReadResult<ShoppingListItem[], DomainError> {
  return updateListItem(items, input.id, input.now, (item) =>
    success({ ...item, notes: input.notes.trim() }),
  );
}
