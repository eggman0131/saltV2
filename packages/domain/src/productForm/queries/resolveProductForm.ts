import type { ProductForm } from '../entities/ProductForm.js';

// Lowercase, trim, collapse internal whitespace. Kept local (not shared with
// canon's normaliseName) so the productForm module stays self-contained.
function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Pure table lookup: find the product form whose matcher identifies `name`.
// A matcher matches when its normalised form is a substring of the normalised
// ingredient name (so "lime juice" matches "fresh lime juice"). Longest matcher
// wins, giving a deterministic result when several forms could match.
export function resolveProductForm(
  name: string,
  forms: readonly ProductForm[],
): ProductForm | null {
  const target = normalise(name);
  if (!target) return null;
  let best: ProductForm | null = null;
  let bestLen = 0;
  for (const form of forms) {
    for (const matcher of form.matchers) {
      const m = normalise(matcher);
      if (m && target.includes(m) && m.length > bestLen) {
        best = form;
        bestLen = m.length;
      }
    }
  }
  return best;
}
