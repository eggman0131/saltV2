import type { ProductForm } from '../entities/ProductForm.js';
import { resolveProductForm } from './resolveProductForm.js';

/**
 * The form a recipe ingredient actually names — `resolveProductForm` plus the
 * parent guard that every caller has to apply and that is easy to forget.
 *
 * A form is claimed ONLY when it resolves to this ingredient's own canon item.
 * Without that check a form since repointed at a different parent would be
 * reported as the route this ingredient took, which it isn't: the ingredient was
 * canonicalised to `canonId`, and a form hanging off some other parent had no
 * part in that. The guard is the difference between "this line names lime juice,
 * whose parent is the lime we matched" and "some form somewhere matched these
 * words".
 *
 * Returns null when the ingredient never parsed, never matched a canon item, or
 * names no form — all three are ordinary states, not failures.
 */
export function resolveIngredientProductForm(
  itemText: string | null | undefined,
  canonId: string | null,
  forms: readonly ProductForm[],
): ProductForm | null {
  if (!itemText || !canonId) return null;
  const form = resolveProductForm(itemText, forms);
  return form && form.parentCanonId === canonId ? form : null;
}
