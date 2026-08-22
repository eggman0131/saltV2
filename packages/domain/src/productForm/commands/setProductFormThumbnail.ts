import { success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { ProductForm } from '../entities/ProductForm.js';

// Sets the product form's icon `thumbnail` (issue #871) — the exact twin of
// `setCanonItemThumbnail`. Used for the hide (`CANON_ICON_HIDDEN`) / unhide /
// regenerate (`null`) escape hatch. Tri-state values: a URL, `null`, or the
// hidden sentinel.
//
// The sentinel itself is `CANON_ICON_HIDDEN` rather than a form-specific copy:
// it is one string describing one tri-state contract, and `isCanonIconRenderable`
// — the read-boundary guard the UI uses — already takes a bare `string | null`
// and knows nothing about which collection the value came from.
export function setProductFormThumbnail(
  form: ProductForm,
  thumbnail: string | null,
): Result<ProductForm, DomainError> {
  return success({ ...form, thumbnail });
}
