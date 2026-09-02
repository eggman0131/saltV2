import type { ProductForm } from '../entities/ProductForm.js';
import { resolveProductForm, type CanonNaming } from './resolveProductForm.js';

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
 *
 * `canon` is a pass-through to `resolveProductForm`'s contested-phrase rule
 * (issue #1180) and is required for the same reason it is required there. It
 * does NOT subsume this function's parent guard: the two reject different
 * things. The contested rule asks whether the winning phrase distinguishes its
 * parent from another canon item the TEXT names; this guard asks whether the
 * form's parent is the canon item this ingredient was actually MATCHED to.
 * A form can pass one and fail the other.
 */
export function resolveIngredientProductForm(
  itemText: string | null | undefined,
  canonId: string | null,
  forms: readonly ProductForm[],
  canon: readonly CanonNaming[],
): ProductForm | null {
  if (!itemText || !canonId) return null;
  const form = resolveProductForm(itemText, forms, canon);
  return form && form.parentCanonId === canonId ? form : null;
}
