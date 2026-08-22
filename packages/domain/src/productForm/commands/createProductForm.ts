import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult, CanonItemUnit } from '@salt/shared-types';
import type { ProductForm } from '../entities/ProductForm.js';
import type { ProductFormIdGenerator } from '../ports/IdGenerator.js';

export interface CreateProductFormInput {
  readonly matchers: readonly string[];
  readonly parentCanonId: string;
  readonly label: string;
  readonly formUnit: CanonItemUnit;
  readonly amountPerParent: number;
}

// Normalise matchers (trim, drop blanks); require a parent, a non-empty label,
// at least one matcher, and a positive yield amount.
function cleanMatchers(matchers: readonly string[]): string[] {
  return matchers.map((m) => m.trim()).filter((m) => m.length > 0);
}

export function createProductForm(
  input: CreateProductFormInput,
  ids: ProductFormIdGenerator,
): ReadResult<ProductForm, DomainError> {
  const label = input.label.trim();
  const matchers = cleanMatchers(input.matchers);
  if (
    !label ||
    !input.parentCanonId.trim() ||
    matchers.length === 0 ||
    !(input.amountPerParent > 0)
  ) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_PRODUCT_FORM });
  }
  return success({
    id: ids.newProductFormId(),
    schemaVersion: 1,
    matchers,
    parentCanonId: input.parentCanonId.trim(),
    label,
    yield: { formUnit: input.formUnit, amountPerParent: input.amountPerParent },
    updatedAt: '',
    // Stated, not omitted (issue #871): a new form has no icon yet, and the
    // onProductFormWritten trigger's edge guard reads exactly this null on the
    // create write to decide to generate. Omitting it would write `undefined`,
    // which Firestore rejects outright.
    thumbnail: null,
  });
}
