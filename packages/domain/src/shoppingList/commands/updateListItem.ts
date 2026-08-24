import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

// The body every single-item shopping-list mutation shares: find the item or
// fail NotFound, let the caller decide the change, stamp `updatedAt` and put it
// back. Internal to the module — not re-exported from `index.ts`.
//
// The equipment module has the same helper for the same reason (issue #924), and
// the two are deliberately NOT one generic helper: they fail with different
// `resource` names and read different collections, so a shared version would
// take both as parameters and say nothing either one does not already say.
//
// Guard order, as in equipment: existence first, then the command's own checks,
// which run with the item in hand.
export function updateListItem(
  items: readonly ShoppingListItem[],
  id: string,
  now: string,
  change: (item: ShoppingListItem) => ReadResult<ShoppingListItem, DomainError>,
): ReadResult<ShoppingListItem[], DomainError> {
  const item = items.find((i) => i.id === id);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'shoppingListItem', id });
  }
  const changed = change(item);
  if (changed.kind !== 'ok') {
    return changed;
  }
  const updated: ShoppingListItem = { ...changed.value, updatedAt: now };
  return success(items.map((i) => (i.id === id ? updated : i)));
}
