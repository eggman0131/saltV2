import { normaliseName } from '../../canon/index.js';
import type { ProductForm } from '../entities/ProductForm.js';

// Pure table lookup: find the product form that `name` identifies.
//
// A form is identified by EVERYTHING it is called — its `label` as well as its
// `matchers`, competing on equal terms. `label` keeps every display use it has;
// it simply gains a second job as matching input. Six of the ten live forms had
// copied the label into `matchers` by hand, and every form that skipped the copy
// was a silent miss ("Chicken Legs", "Lemon zest") — so the label was already
// treated as matching input by the people authoring forms (issue #818).
//
// Both sides are folded with canon's `normaliseName` rather than a local
// lowercase/trim. Product-form resolution asks EXACTLY canon's question — does
// this ingredient text name this thing — so the two halves of one pipeline must
// not disagree about plurals, punctuation or quantity tokens. They did: an
// ingredient reading "chicken breast" could not find the form whose only matcher
// was "chicken breasts", and fell through to minting an orphan canon item.
// (Contrast `cookSession/normaliseContainerName`, which deliberately refuses this
// same helper — a container name is a label a cook reads off a bowl, and folding
// plurals would merge bowls a human can tell apart. Different question, so it
// keeps its own normaliser. This one is the same question, so it shares.)
//
// Containment is token-aligned: a phrase must occupy whole words of the
// ingredient, so a form matched on "oat" matches "rolled oats" and not "goat
// cheese". Longest phrase wins, measured on the NORMALISED phrase so the
// ordering stays deterministic.
//
// Match-time only: nothing here is written back. Stored labels and matchers stay
// exactly as they were typed.
export function resolveProductForm(
  name: string,
  forms: readonly ProductForm[],
): ProductForm | null {
  const target = normaliseName(name);
  if (!target) return null;
  // Pad both sides so `includes` can only land on token boundaries.
  const padded = ` ${target} `;
  let best: ProductForm | null = null;
  let bestLen = 0;
  for (const form of forms) {
    for (const phrase of [form.label, ...form.matchers]) {
      const p = normaliseName(phrase);
      if (p && p.length > bestLen && padded.includes(` ${p} `)) {
        best = form;
        bestLen = p.length;
      }
    }
  }
  return best;
}
