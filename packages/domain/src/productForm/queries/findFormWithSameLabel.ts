import { normaliseName } from '../../canon/index.js';
import type { ProductForm } from '../entities/ProductForm.js';

// Pure table lookup: find the product form ON THIS PARENT already called this
// (issue #854; scoped to the parent by issue #1127).
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
// KEYED ON THE PARENT. An earlier version of this header called parent keying
// impossible: the call site's proposal has no resolved parent id, and resolving
// one mints a canon item as a side effect. The premise was right and the
// conclusion wrong — the caller need not resolve anything, because the proposal
// carries the parent's NAME and the caller already holds a name-to-id table in
// memory. So the id arrives as an argument, nothing is minted, and this stays a
// pure lookup. Without it a bare-noun label ("Zest", "Juice", "Stock") matched
// across the whole table, and a lime's zest was filed under lemons.
//
// A `null` parent means only that THIS CALL was not given an id — never that
// the parent doesn't exist. The caller (`canonicaliseRecipeIngredients.ts`) has
// two reasons to pass `null`: a parent about to be minted, which genuinely has
// nothing stored on it yet, and an exact-normalised-name lookup that missed —
// a canon-list read failure, or a `parentName` the model resolved by synonym,
// fuzzy match or embedding rather than copying it verbatim from the candidate
// list. In that second case the parent already exists and a stored form may
// already be on it, so this function still answers `null` (it has no id to
// search with), but the caller does not treat that as final: it calls this
// function again with the AUTHORITATIVE id, once `resolveParentCanonId` has
// resolved one, before minting anything (issue #1127 review, finding B1 — a
// duplicate same-labelled form was minted on a parent that already had one,
// regressing #854). What stays true regardless of why `null` arrived: this
// function never falls back to a table-wide search for it — an unknown parent
// must never degrade to "any parent".
//
// THE BOUNDARY OF THAT CLAIM, stated because it is not what a reader assumes.
// Parent scoping here makes the PROPOSAL path parent-safe, and only that path.
// It does not make product-form binding parent-safe in general:
// `resolveProductForm` matches on `[form.label, ...form.matchers]`
// (`resolveProductForm.ts:42`), so a stored form's own label is itself a global,
// parent-blind matching phrase — and both `resolveProductForm` calls in
// `canonicaliseRecipeIngredients.ts` still cross parents on a bare-noun label:
// `:165`, the pre-arbitration bind, which fires first and owns the reported
// symptom, and the sibling `resolveProductForm` call that sits right beside
// this function's own call, in the same proposal-covering check. Follow-up
// issue #1180 owns them; the measurement is in #1127's Phase-1 deviation
// comment, and the limit is pinned by the `KNOWN LIMIT` case in
// `apps/cloud-functions/tests/flows/canonicaliseRecipeIngredients.proposal.test.ts`.
//
// Match-time only: nothing here is written back. Stored labels stay exactly as
// they were typed.
export function findFormWithSameLabel(
  label: string,
  parentCanonId: string | null,
  forms: readonly ProductForm[],
): ProductForm | null {
  if (parentCanonId === null) return null;
  const target = normaliseName(label);
  if (!target) return null;
  return (
    forms.find(
      (form) => form.parentCanonId === parentCanonId && normaliseName(form.label) === target,
    ) ?? null
  );
}
