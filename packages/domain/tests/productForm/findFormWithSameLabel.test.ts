import { describe, it, expect } from 'vitest';
import { findFormWithSameLabel } from '../../src/productForm/queries/findFormWithSameLabel.js';
import { resolveProductForm } from '../../src/productForm/queries/resolveProductForm.js';
import type { ProductForm } from '../../src/productForm/entities/ProductForm.js';

// Issue #854. The dedupe check that `resolveProductForm` structurally cannot
// perform: a proposal BROADER than a stored form's matchers.

function form(overrides: Partial<ProductForm> & { id: string; label: string }): ProductForm {
  return {
    schemaVersion: 1,
    matchers: [],
    parentCanonId: 'canon-lime',
    yield: { formUnit: 'ml', amountPerParent: 30 },
    needs_approval: false,
    updatedAt: '',
    ...overrides,
  };
}

describe('findFormWithSameLabel', () => {
  it('finds a form whose label matches exactly', () => {
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    expect(findFormWithSameLabel('Lime juice', forms)?.id).toBe('a');
  });

  it('folds case, plurals and punctuation through normaliseName', () => {
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    // Same name, differently typed — one form, not four.
    expect(findFormWithSameLabel('lime juice', forms)?.id).toBe('a');
    expect(findFormWithSameLabel('  LIME JUICE  ', forms)?.id).toBe('a');
    expect(findFormWithSameLabel('Lime juices', forms)?.id).toBe('a');
    expect(findFormWithSameLabel('Lime-juice', forms)?.id).toBe('a');
  });

  it('returns null when no form carries that label', () => {
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    expect(findFormWithSameLabel('Lemon zest', forms)).toBeNull();
  });

  it('returns null for an empty or normalisation-empty label', () => {
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    expect(findFormWithSameLabel('', forms)).toBeNull();
    expect(findFormWithSameLabel('   ', forms)).toBeNull();
    // normaliseName strips pure-digit and word-number tokens, so "2" folds to "".
    expect(findFormWithSameLabel('2', forms)).toBeNull();
  });

  it('returns null against an empty table', () => {
    expect(findFormWithSameLabel('Lime juice', [])).toBeNull();
  });

  it('is EQUALITY, not containment — a longer label is not the same form', () => {
    // The asymmetry this query exists to avoid re-importing: "Lime juice" must
    // not answer for "Fresh lime juice concentrate" merely because the words
    // appear inside it.
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    expect(findFormWithSameLabel('Fresh lime juice concentrate', forms)).toBeNull();
    expect(findFormWithSameLabel('Juice', forms)).toBeNull();
  });

  it('catches the staging duplicate that matcher containment cannot see', () => {
    // The real shape, as stored on staging: one hand-fixed form with narrow
    // matchers, and an AI proposal for the SAME component whose matcher is the
    // bare generic word. `resolveProductForm(proposal.matcher, forms)` is null —
    // "juice" does not contain "lime juice" — so the mint site used to write a
    // second `Lime juice` form on the same parent, quietly re-broadening what
    // had just been corrected by hand.
    const existing = form({
      id: 'a5a5cfd2',
      label: 'Lime juice',
      matchers: ['lime juice', 'fresh lime juice'],
    });
    const forms = [existing];

    expect(resolveProductForm('juice', forms)).toBeNull();
    expect(findFormWithSameLabel('Lime juice', forms)?.id).toBe('a5a5cfd2');
  });

  it('returns the first match when the table already holds duplicates', () => {
    // Recovery case: the table may already carry the duplicate this prevents.
    // Binding to either is correct — both name the same component on the same
    // parent — so the query is deterministic rather than clever about it.
    const forms = [
      form({ id: 'first', label: 'Lime juice', matchers: ['lime juice'] }),
      form({ id: 'second', label: 'Lime juice', matchers: ['juice'] }),
    ];
    expect(findFormWithSameLabel('Lime juice', forms)?.id).toBe('first');
  });
});
