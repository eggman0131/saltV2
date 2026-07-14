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
  const candidates = new Set(['canon-lime', 'canon-butter']);
  const accepted: ProductFormArbitrationAIOutput = {
    modifier_kind: 'component',
    parent_id: 'canon-lime',
    matcher: '  lime juice ',
    label: ' Lime juice ',
    form_unit: 'ml',
    amount_per_parent: 30,
    reasoning: 'juice is a component extracted from the whole lime',
  };

  it('maps a component answer to a trimmed form proposal', () => {
    const p = decideProductFormProposal(accepted, candidates);
    expect(p).toEqual({
      kind: 'form',
      parentCanonId: 'canon-lime',
      matcher: 'lime juice',
      label: 'Lime juice',
      formUnit: 'ml',
      amountPerParent: 30,
    });
  });

  it('rejects an action modifier — a prep state, not a form (e.g. melted butter)', () => {
    // The core fix (issue #500): "melted butter" is a preparation of the buyable
    // Butter, not a component. It must never become a product form.
    const melted: ProductFormArbitrationAIOutput = {
      ...accepted,
      modifier_kind: 'action',
      parent_id: 'canon-butter',
      matcher: 'melted butter',
      label: 'Melted butter',
      form_unit: 'g',
      amount_per_parent: 250,
    };
    expect(decideProductFormProposal(melted, candidates).kind).toBe('none');
  });

  it('rejects a descriptor / ordinary product (modifier_kind none, e.g. flaky sea salt)', () => {
    expect(decideProductFormProposal({ ...accepted, modifier_kind: 'none' }, candidates).kind).toBe(
      'none',
    );
  });

  it('rejects a parent not among the offered candidates', () => {
    expect(
      decideProductFormProposal({ ...accepted, parent_id: 'canon-ghost' }, candidates).kind,
    ).toBe('none');
  });

  it('rejects a non-positive or missing yield', () => {
    expect(decideProductFormProposal({ ...accepted, amount_per_parent: 0 }, candidates).kind).toBe(
      'none',
    );
    expect(
      decideProductFormProposal({ ...accepted, amount_per_parent: null }, candidates).kind,
    ).toBe('none');
  });

  it('rejects empty matcher / label / null unit', () => {
    expect(decideProductFormProposal({ ...accepted, matcher: '  ' }, candidates).kind).toBe('none');
    expect(decideProductFormProposal({ ...accepted, label: '' }, candidates).kind).toBe('none');
    expect(decideProductFormProposal({ ...accepted, form_unit: null }, candidates).kind).toBe(
      'none',
    );
  });
});
