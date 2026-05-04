import { success } from '@salt/shared-types';
import type { DomainError, Result, ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export interface ApproveCanonItemOverrides {
  readonly shoppingBehavior?: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
  readonly unit?: CanonItemUnit;
  readonly reasoning?: string;
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
    ...(overrides?.unit !== undefined ? { unit: overrides.unit } : {}),
    ...(overrides?.reasoning !== undefined ? { reasoning: overrides.reasoning } : {}),
  });
}
