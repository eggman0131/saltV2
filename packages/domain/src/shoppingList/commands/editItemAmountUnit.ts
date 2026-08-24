import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { updateListItem } from './updateListItem.js';

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
  return updateListItem(items, input.id, input.now, (item) => {
    // Strip existing amount/unit then add back only what's defined
    const { amount: _a, unit: _u, ...base } = item;
    return success({
      ...base,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
    } as ShoppingListItem);
  });
}
