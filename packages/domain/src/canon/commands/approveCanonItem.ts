import { success } from '@salt/shared-types';
import type { DomainError, Result, ShoppingBehavior } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export interface ApproveCanonItemOverrides {
  readonly shoppingBehavior?: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
}

export function approveCanonItem(
  item: CanonItem,
  overrides?: ApproveCanonItemOverrides,
): Result<CanonItem, DomainError> {
  return success({
    ...item,
    needs_approval: false,
    ...(overrides?.shoppingBehavior !== undefined
      ? { shoppingBehavior: overrides.shoppingBehavior }
      : {}),
    ...(overrides?.largeQuantityThreshold !== undefined
      ? { largeQuantityThreshold: overrides.largeQuantityThreshold }
      : {}),
  });
}
