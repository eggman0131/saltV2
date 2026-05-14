import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import type { SourceRef } from '../entities/SourceRef.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface AddItemInput {
  readonly rawText: string;
  readonly notes?: string;
  readonly source: SourceRef;
  readonly now: string;
}

export function addItem(
  items: readonly ShoppingListItem[],
  input: AddItemInput,
  ids: IdGenerator,
): ReadResult<ShoppingListItem[], DomainError> {
  const rawText = input.rawText.trim();
  if (!rawText) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_ITEM_RAW_TEXT });
  }
  const newItem: ShoppingListItem = {
    id: ids.newItemId(),
    rawText,
    notes: input.notes?.trim() ?? '',
    sources: [input.source],
    canonId: null,
    matchState: 'pending',
    checked: false,
    schemaVersion: 1 as const,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return success([...items, newItem]);
}
