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
  // Approving clears the record along with the flag (issue #193). OMIT the key
  // — never write `[]`: an absent field means "nothing pending", and `[]` would
  // be an extra shape for every reader to handle for no gain. Firestore writes
  // are full-doc `setDoc`, so omitting removes it from the stored doc too.
  const { pendingChanges: _cleared, ...rest } = item;
  return success({
    ...rest,
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
