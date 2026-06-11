import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { MatchState, ShoppingListItem } from '../entities/ShoppingListItem.js';
import type { SourceRef } from '../entities/SourceRef.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface AddItemInput {
  readonly rawText: string;
  readonly notes?: string;
  readonly source: SourceRef;
  readonly now: string;
  /** Pre-set canonId when adding an already-matched item (e.g. from a recipe). */
  readonly canonId?: string | null;
  /** Pre-set matchState; defaults to 'pending'. */
  readonly matchState?: MatchState;
  readonly amount?: number;
  readonly unit?: string;
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
  const base = {
    id: ids.newItemId(),
    rawText,
    notes: input.notes?.trim() ?? '',
    sources: [input.source],
    canonId: input.canonId ?? null,
    matchState: input.matchState ?? ('pending' as const),
    checked: false,
    schemaVersion: 1 as const,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const newItem: ShoppingListItem = {
    ...base,
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
  };
  return success([...items, newItem]);
}
