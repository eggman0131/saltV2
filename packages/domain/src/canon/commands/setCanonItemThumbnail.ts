import { success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

// Sets the canon item's icon `thumbnail` (issue #148). Used for the hide
// ("hidden") / unhide / regenerate (null) escape hatch. Tri-state values:
// a URL, `null` (no icon / regenerate), or `CANON_ICON_HIDDEN`.
export function setCanonItemThumbnail(
  item: CanonItem,
  thumbnail: string | null,
): Result<CanonItem, DomainError> {
  return success({ ...item, thumbnail });
}
