import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export function renameCanonItem(item: CanonItem, newName: string): Result<CanonItem, DomainError> {
  const name = newName.trim();
  if (!name) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_CANON_NAME });
  }
  return success({ ...item, name });
}
