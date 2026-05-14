import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface EditItemRawTextInput {
  readonly id: string;
  readonly rawText: string;
  readonly now: string;
}

export function editItemRawText(
  items: readonly ShoppingListItem[],
  input: EditItemRawTextInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const rawText = input.rawText.trim();
  if (!rawText) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_ITEM_RAW_TEXT });
  }
  const item = items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  return success(
    items.map((i) =>
      i.id === input.id
        ? { ...i, rawText, canonId: null, matchState: 'pending' as const, updatedAt: input.now }
        : i,
    ),
  );
}
