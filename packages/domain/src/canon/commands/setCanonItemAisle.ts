import { success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export function setCanonItemAisle(
  item: CanonItem,
  aisleId: string | null,
): Result<CanonItem, DomainError> {
  return success({ ...item, aisleId });
}
