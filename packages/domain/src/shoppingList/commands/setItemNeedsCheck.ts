import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface SetItemNeedsCheckInput {
  readonly id: string;
  readonly needsCheck: boolean;
  readonly now: string;
}

// Set or clear an item's verification flag (issue #185) — the amber "Need it?"
// prompt asking the shopper to confirm before buying. Recipe-add supplies the
// flag at creation; this is the only way to change it afterwards, in either
// direction. `needsCheck` is its own axis: not `matchState` (the canon-matching
// lifecycle) and not `checked` (ticked off in the aisle).
export function setItemNeedsCheck(
  items: readonly ShoppingListItem[],
  input: SetItemNeedsCheckInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const item = items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  return success(
    items.map((i) =>
      i.id === input.id ? { ...i, needsCheck: input.needsCheck, updatedAt: input.now } : i,
    ),
  );
}
