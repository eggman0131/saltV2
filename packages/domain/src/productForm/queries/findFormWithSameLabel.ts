import { normaliseName } from '../../canon/index.js';
import type { ProductForm } from '../entities/ProductForm.js';

// Pure table lookup: find the product form ALREADY called this (issue #854).
//
// The companion to `resolveProductForm`, asking a deliberately different
// question. `resolveProductForm` asks "does this ingredient text name a form" —
// containment, longest phrase wins — which answers a proposal that is NARROWER
// than a stored phrase. It cannot answer the duplicate actually observed in
// production: the same component proposed with a BROADER matcher. A proposal
// labelled "Lime juice" carrying matcher `["juice"]` resolves against a stored
// form whose matchers are `["lime juice","fresh lime juice"]` to nothing at all,
// so it was minted as a second `Lime juice` form on the same parent — and every
// hand-correction of the stored matchers was quietly re-broadened by the next
// recipe that mentioned juice.
//
// Equality, not containment, and on the LABEL. The label is the component's
// human name, and two forms with the same name on the same parent are the same
// form however their matchers were phrased. Containment on the label would
// re-import the very asymmetry this exists to cover.
//
// Both sides fold through canon's `normaliseName`, exactly as
// `resolveProductForm` does, so the two halves of one pipeline cannot disagree
// about case, plurals or punctuation ("Lime Juice" / "lime juices" / "Lime
// juice" are one name).
//
// Deliberately NOT keyed on `parentCanonId`: at the only call site the proposal's
// parent is still unresolved, and resolving it early mints a canon item as a side
// effect that would then be thrown away.
//
// Match-time only: nothing here is written back. Stored labels stay exactly as
// they were typed.
export function findFormWithSameLabel(
  label: string,
  forms: readonly ProductForm[],
): ProductForm | null {
  const target = normaliseName(label);
  if (!target) return null;
  return forms.find((form) => normaliseName(form.label) === target) ?? null;
}
