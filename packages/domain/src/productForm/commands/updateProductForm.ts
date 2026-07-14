import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult, CanonItemUnit } from '@salt/shared-types';
import type { ProductForm } from '../entities/ProductForm.js';

export interface UpdateProductFormInput {
  readonly matchers: readonly string[];
  readonly parentCanonId: string;
  readonly label: string;
  readonly formUnit: CanonItemUnit;
  readonly amountPerParent: number;
}

// Apply an edit to an existing form, re-validating the same invariants as
// create. Pure — returns a new ProductForm, never mutates the input.
export function updateProductForm(
  form: ProductForm,
  input: UpdateProductFormInput,
): ReadResult<ProductForm, DomainError> {
  const label = input.label.trim();
  const matchers = input.matchers.map((m) => m.trim()).filter((m) => m.length > 0);
  if (
    !label ||
    !input.parentCanonId.trim() ||
    matchers.length === 0 ||
    !(input.amountPerParent > 0)
  ) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_PRODUCT_FORM });
  }
  return success({
    ...form,
    matchers,
    parentCanonId: input.parentCanonId.trim(),
    label,
    yield: { formUnit: input.formUnit, amountPerParent: input.amountPerParent },
  });
}
