import { describe, it, expect } from 'vitest';
import { confirmProductForm, decideProductFormProposal, resolveProductForm } from '@salt/domain';
import type { ProductForm } from '@salt/domain';
import type { ProductFormArbitrationAIOutput } from '@salt/domain/schemas';

const pendingForm: ProductForm = {
  id: 'pf-pending',
  schemaVersion: 1,
  matchers: ['grated nutmeg'],
  parentCanonId: 'canon-nutmeg',
  label: 'Grated nutmeg',
  yield: { formUnit: 'g', amountPerParent: 12 },
  updatedAt: '2026-07-14T00:00:00.000Z',
  needs_approval: true,
};

describe('confirmProductForm', () => {
  it('clears needs_approval without mutating the input', () => {
    const result = confirmProductForm(pendingForm);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.needs_approval).toBe(false);
    expect(result.value.id).toBe('pf-pending'); // identity + fields preserved
    expect(result.value.parentCanonId).toBe('canon-nutmeg');
    expect(pendingForm.needs_approval).toBe(true); // input untouched
  });
});

describe('a pending form resolves live (used-but-flagged)', () => {
  it('resolveProductForm ignores needs_approval — a pending form still matches', () => {
    // The whole behavioural contract: a needs_approval form is not filtered out of
    // resolution. It binds recipes the moment it is written, before any review.
    const hit = resolveProductForm('freshly grated nutmeg', [pendingForm]);
    expect(hit?.id).toBe('pf-pending');
    expect(hit?.needs_approval).toBe(true);
  });
});

describe('decideProductFormProposal', () => {
  const accepted: ProductFormArbitrationAIOutput = {
    modifier_kind: 'component',
    parent_name: '  Lime ',
    parent_id: 'canon-lime',
    matcher: '  lime juice ',
    label: ' Lime juice ',
    form_unit: 'ml',
    amount_per_parent: 30,
    reasoning: 'juice is a component extracted from the whole lime',
  };

  it('maps a component answer to a trimmed form proposal carrying parentName', () => {
    const p = decideProductFormProposal(accepted);
    expect(p).toEqual({
      kind: 'form',
      parentName: 'Lime',
      matcher: 'lime juice',
      label: 'Lime juice',
      formUnit: 'ml',
      amountPerParent: 30,
    });
  });

  it('accepts a component whose parent is NOT in any catalog — candidates no longer gate', () => {
    // The Phase 1 fix (issue #500): a parent absent from the catalog ("Lime" with
    // no existing canon) must still yield a form proposal — the CF flow mints it
    // via matchOrCreateBatch. parent_id being null (no catalog hint) is fine.
    const p = decideProductFormProposal({ ...accepted, parent_id: null });
    expect(p.kind).toBe('form');
    if (p.kind === 'form') expect(p.parentName).toBe('Lime');
  });

  it('rejects an action modifier — a prep state, not a form (e.g. melted butter)', () => {
    // The core fix (issue #500): "melted butter" is a preparation of the buyable
    // Butter, not a component. It must never become a product form.
    const melted: ProductFormArbitrationAIOutput = {
      ...accepted,
      modifier_kind: 'action',
      parent_name: 'Butter',
      matcher: 'melted butter',
      label: 'Melted butter',
      form_unit: 'g',
      amount_per_parent: 250,
    };
    expect(decideProductFormProposal(melted).kind).toBe('none');
  });

  it('rejects a descriptor / ordinary product (modifier_kind none, e.g. flaky sea salt)', () => {
    expect(decideProductFormProposal({ ...accepted, modifier_kind: 'none' }).kind).toBe('none');
  });

  it('rejects an empty / missing parent_name', () => {
    expect(decideProductFormProposal({ ...accepted, parent_name: '  ' }).kind).toBe('none');
    expect(decideProductFormProposal({ ...accepted, parent_name: null }).kind).toBe('none');
  });

  it('rejects a non-positive or missing yield', () => {
    expect(decideProductFormProposal({ ...accepted, amount_per_parent: 0 }).kind).toBe('none');
    expect(decideProductFormProposal({ ...accepted, amount_per_parent: null }).kind).toBe('none');
  });

  it('rejects empty matcher / label / null unit', () => {
    expect(decideProductFormProposal({ ...accepted, matcher: '  ' }).kind).toBe('none');
    expect(decideProductFormProposal({ ...accepted, label: '' }).kind).toBe('none');
    expect(decideProductFormProposal({ ...accepted, form_unit: null }).kind).toBe('none');
  });
});
