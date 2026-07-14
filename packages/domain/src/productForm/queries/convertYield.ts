import type { ProductFormYield } from '../entities/ProductForm.js';

// Convert an amount expressed in a form's unit into a parent-item count.
// e.g. 90 ml of lime juice with a yield of 30 ml per lime → 3 limes.
// The caller is responsible for passing `amount` in the yield's `formUnit`.
// Pure. A non-positive amountPerParent can't yield a count → 0.
// ponytail: no unit-system conversion (g↔ml etc.); amount must already be in formUnit.
export function convertYield(amount: number, y: ProductFormYield): number {
  if (!(y.amountPerParent > 0)) return 0;
  return amount / y.amountPerParent;
}
