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
  // A move carries the item's canon match with it (issue #699). Canon is global
  // and items hold no list identity — membership is positional, which is why a
  // move is a delete + set of the same doc id — so changing lists cannot
  // invalidate a match. Resetting it here bought nothing and cost a full
  // re-match per moved item: a visible spinner under OTHER, and for a
  // product-form row ("Lime ×3") a risk of landing on a different parent than
  // the one it was pinned to at recipe-add. Editing the text is what
  // invalidates a match; see editItemRawText.
  const moved = sourceItems
    .filter((i) => idSet.has(i.id))
    .map((i) => ({ ...i, updatedAt: input.now }));
  return success({
    sourceItems: sourceItems.filter((i) => !idSet.has(i.id)),
    targetItems: [...targetItems, ...moved],
  });
}
