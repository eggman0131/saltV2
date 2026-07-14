import type { CanonItemUnit, ProductForm } from '../entities/ProductForm.js';
import { convertYield } from './convertYield.js';

// The whole parent-item count to buy so a recipe's product-form ingredient is
// covered, or null to degrade to identity-only (show the product, no count).
// `amount` is the ingredient amount already scaled to servings and expressed in
// `ingUnit` (a null recipe unit is a `count`). convertYield does NO unit-system
// conversion, so the units must agree: a mismatch (e.g. a count of limes against
// an ml yield) returns null rather than guessing (Rule 10). A degenerate/zero
// yield also degrades to null. A positive amount always needs at least one
// parent, so a sub-1 count rounds up to 1 (you can't buy 0 limes for juice).
export function formParentCount(
  amount: number,
  ingUnit: CanonItemUnit,
  form: ProductForm,
): number | null {
  if (ingUnit !== form.yield.formUnit) return null;
  const raw = convertYield(amount, form.yield);
  if (!(raw > 0)) return null;
  return Math.max(1, Math.round(raw));
}
