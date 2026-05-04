import { success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { CanonItem, ShoppingBehavior, CanonItemUnit } from '../entities/CanonItem.js';

export function setCanonItemShoppingBehavior(
  item: CanonItem,
  shoppingBehavior: ShoppingBehavior,
): Result<CanonItem, DomainError> {
  return success({ ...item, shoppingBehavior });
}

export function setCanonItemThreshold(
  item: CanonItem,
  largeQuantityThreshold: number | undefined,
  unit: CanonItemUnit | undefined,
): Result<CanonItem, DomainError> {
  // Destructure optional fields so we can re-add them conditionally,
  // avoiding exactOptionalPropertyTypes violations from explicit undefined spread.
  const { largeQuantityThreshold: _l, unit: _u, ...base } = item;
  return success({
    ...base,
    ...(largeQuantityThreshold !== undefined ? { largeQuantityThreshold } : {}),
    ...(unit !== undefined ? { unit } : {}),
  } as CanonItem);
}
