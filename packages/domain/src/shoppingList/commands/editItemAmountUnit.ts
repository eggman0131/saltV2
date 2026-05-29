import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface EditItemAmountUnitInput {
  readonly id: string;
  readonly amount: number | undefined;
  readonly unit: string | undefined;
  readonly now: string;
}

export function editItemAmountUnit(
  items: readonly ShoppingListItem[],
  input: EditItemAmountUnitInput,
): ReadResult<ShoppingListItem[], DomainError> {
  const item = items.find((i) => i.id === input.id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id: input.id });
  }
  // Strip existing amount/unit then add back only what's defined
  const { amount: _a, unit: _u, ...base } = item;
  const updated = {
    ...base,
    updatedAt: input.now,
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
  } as ShoppingListItem;
  return success(items.map((i) => (i.id === input.id ? updated : i)));
}
