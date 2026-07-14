import type {
  ProductFormArbitrationAIOutput,
  ProductFormProposal,
} from '../../schemas/productFormArbitration.js';

// Pure gate over a raw product-form arbitration output (issue #500, Phase 3).
// Decides whether the model's answer is a usable proposal: the modifier must be a
// physical `component` of the parent (a juice/zest/yolk — NOT an `action` prep
// state like melted/grated, and NOT a mere descriptor — see modifier_kind), it
// must name a non-empty parent, and carry a non-empty matcher/label plus a
// positive yield. The parent is named by `parent_name`; the CF flow resolves it
// to a canon id via matchOrCreateBatch (reuse-or-create), so a parent absent from
// the catalog no longer blocks the proposal. Anything short of that is a clean
// `none` (the caller then falls back to normal matching — Rule 10). Kept pure and
// in the domain so the accept/reject policy is unit-testable without the AI or
// Firestore. `modifier_kind==='component'` remains the ONLY mint gate.
export function decideProductFormProposal(ai: ProductFormArbitrationAIOutput): ProductFormProposal {
  const parentName = ai.parent_name?.trim() ?? '';
  const matcher = ai.matcher?.trim() ?? '';
  const label = ai.label?.trim() ?? '';
  if (
    ai.modifier_kind !== 'component' ||
    parentName.length === 0 ||
    matcher.length === 0 ||
    label.length === 0 ||
    ai.form_unit == null ||
    !(ai.amount_per_parent != null && ai.amount_per_parent > 0)
  ) {
    return { kind: 'none' };
  }
  return {
    kind: 'form',
    parentName,
    matcher,
    label,
    formUnit: ai.form_unit,
    amountPerParent: ai.amount_per_parent,
  };
}
