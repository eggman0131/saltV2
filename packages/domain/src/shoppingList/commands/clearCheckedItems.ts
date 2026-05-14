import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export function clearCheckedItems(
  items: readonly ShoppingListItem[],
): ReadResult<ShoppingListItem[], DomainError> {
  return success(items.filter((i) => !i.checked));
}
