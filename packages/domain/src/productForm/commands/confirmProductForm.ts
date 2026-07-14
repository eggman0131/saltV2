import { success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { ProductForm } from '../entities/ProductForm.js';

// Confirm an AI-seeded product form (issue #500, Phase 3) — mirrors canon's
// `approveCanonItem`. Pure: flips the needs-review flag off and returns a new
// form, never mutates the input. Edits to the suggested parent/yield are applied
// separately via `updateProductForm`; this only clears the pending state. A
// pending form already resolves recipes live, so confirming CORRECTS/records the
// review, it does not unlock use.
export function confirmProductForm(form: ProductForm): Result<ProductForm, DomainError> {
  return success({ ...form, needs_approval: false });
}
