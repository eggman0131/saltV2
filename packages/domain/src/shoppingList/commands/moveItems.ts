import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface MoveItemsInput {
  readonly itemIds: readonly string[];
  readonly now: string;
}

export interface MoveItemsResult {
  readonly sourceItems: readonly ShoppingListItem[];
  readonly targetItems: readonly ShoppingListItem[];
}

export function moveItems(
  sourceItems: readonly ShoppingListItem[],
  targetItems: readonly ShoppingListItem[],
  input: MoveItemsInput,
): ReadResult<MoveItemsResult, DomainError> {
  for (const id of input.itemIds) {
    const exists = sourceItems.some((i) => i.id === id);
    if (!exists) {
      return failure({ kind: 'NotFound', resource: 'shoppingListItem', id });
    }
  }
  const idSet = new Set(input.itemIds);
  const moved = sourceItems
    .filter((i) => idSet.has(i.id))
    .map((i) => ({ ...i, canonId: null, matchState: 'pending' as const, updatedAt: input.now }));
  return success({
    sourceItems: sourceItems.filter((i) => !idSet.has(i.id)),
    targetItems: [...targetItems, ...moved],
  });
}
