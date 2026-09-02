import { describe, it, expect } from 'vitest';
import { findFormWithSameLabel } from '../../src/productForm/queries/findFormWithSameLabel.js';
import { resolveProductForm } from '../../src/productForm/queries/resolveProductForm.js';
import type { ProductForm } from '../../src/productForm/entities/ProductForm.js';
import type { CanonNaming } from '../../src/productForm/queries/resolveProductForm.js';
// Empty canon list: `resolveProductForm`'s contested-phrase rule (issue #1180)
// is inert without one, so these cases measure only what they mean to.
const NO_CANON: readonly CanonNaming[] = [];

// Issue #854. The dedupe check that `resolveProductForm` structurally cannot
// perform: a proposal BROADER than a stored form's matchers.

function form(overrides: Partial<ProductForm> & { id: string; label: string }): ProductForm {
  return {
    schemaVersion: 1,
    matchers: [],
    thumbnail: null,
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
    expect(findFormWithSameLabel('Lime juice', 'canon-lime', forms)?.id).toBe('a');
  });

  it('folds case, plurals and punctuation through normaliseName', () => {
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    // Same name, differently typed — one form, not four.
    expect(findFormWithSameLabel('lime juice', 'canon-lime', forms)?.id).toBe('a');
    expect(findFormWithSameLabel('  LIME JUICE  ', 'canon-lime', forms)?.id).toBe('a');
    expect(findFormWithSameLabel('Lime juices', 'canon-lime', forms)?.id).toBe('a');
    expect(findFormWithSameLabel('Lime-juice', 'canon-lime', forms)?.id).toBe('a');
  });

  it('returns null when no form carries that label', () => {
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    expect(findFormWithSameLabel('Lemon zest', 'canon-lime', forms)).toBeNull();
  });

  it('returns null for an empty or normalisation-empty label', () => {
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    expect(findFormWithSameLabel('', 'canon-lime', forms)).toBeNull();
    expect(findFormWithSameLabel('   ', 'canon-lime', forms)).toBeNull();
    // normaliseName strips pure-digit and word-number tokens, so "2" folds to "".
    expect(findFormWithSameLabel('2', 'canon-lime', forms)).toBeNull();
  });

  it('returns null against an empty table', () => {
    expect(findFormWithSameLabel('Lime juice', 'canon-lime', [])).toBeNull();
  });

  it('is EQUALITY, not containment — a longer label is not the same form', () => {
    // The asymmetry this query exists to avoid re-importing: "Lime juice" must
    // not answer for "Fresh lime juice concentrate" merely because the words
    // appear inside it.
    const forms = [form({ id: 'a', label: 'Lime juice' })];
    expect(findFormWithSameLabel('Fresh lime juice concentrate', 'canon-lime', forms)).toBeNull();
    expect(findFormWithSameLabel('Juice', 'canon-lime', forms)).toBeNull();
  });

  it('catches the staging duplicate that matcher containment cannot see', () => {
    // The real shape, as stored on staging: one hand-fixed form with narrow
    // matchers, and an AI proposal for the SAME component whose matcher is the
    // bare generic word. `resolveProductForm(proposal.matcher, forms, canon)` is null —
    // "juice" does not contain "lime juice" — so the mint site used to write a
    // second `Lime juice` form on the same parent, quietly re-broadening what
    // had just been corrected by hand.
    const existing = form({
      id: 'a5a5cfd2',
      label: 'Lime juice',
      matchers: ['lime juice', 'fresh lime juice'],
    });
    const forms = [existing];

    expect(resolveProductForm('juice', forms, NO_CANON)).toBeNull();
    expect(findFormWithSameLabel('Lime juice', 'canon-lime', forms)?.id).toBe('a5a5cfd2');
  });

  it('returns the first match when the table already holds duplicates', () => {
    // Recovery case: the table may already carry the duplicate this prevents.
    // Binding to either is correct — both name the same component on the same
    // parent — so the query is deterministic rather than clever about it.
    const forms = [
      form({ id: 'first', label: 'Lime juice', matchers: ['lime juice'] }),
      form({ id: 'second', label: 'Lime juice', matchers: ['juice'] }),
    ];
    expect(findFormWithSameLabel('Lime juice', 'canon-lime', forms)?.id).toBe('first');
  });

  // ── Parent scoping, and the edge of it (issue #1127) ────────────────────────

  it('does NOT return a same-labelled form parented on something else', () => {
    // The defect: "Zest" learned on Lemon answered for a lime's zest, so the
    // recipe's ingredient was bound to Lemon and the shopping list said buy
    // lemons. Zest of a lemon and zest of a lime are two different things.
    const forms = [form({ id: 'lemon-zest', label: 'Zest', parentCanonId: 'canon-lemon' })];
    expect(findFormWithSameLabel('Zest', 'canon-lime', forms)).toBeNull();
    // Same table, same label, the parent it actually is on.
    expect(findFormWithSameLabel('Zest', 'canon-lemon', forms)?.id).toBe('lemon-zest');
  });

  it('returns null for an unknown parent rather than searching the whole table', () => {
    // `null` is what the caller passes when this exact-name lookup couldn't
    // resolve the parent — which is not always because the parent doesn't
    // exist yet (see this query's header). Either way, an unknown parent must
    // never degrade to "any parent".
    const forms = [form({ id: 'lemon-zest', label: 'Zest', parentCanonId: 'canon-lemon' })];
    expect(findFormWithSameLabel('Zest', null, forms)).toBeNull();
  });

  it('is not what stops a bare-noun label crossing parents — that is #1180', () => {
    // Kept as a signpost, and stated as what it is rather than as a pin. Two
    // different mechanisms let a `Zest` form on Lemon claim a lime's zest, and
    // this query only ever answered one of them: the proposal same-label dedupe.
    // The other is that a form's own label is a matching phrase, which
    // `resolveProductForm` now handles itself by refusing a CONTESTED phrase
    // (issue #1180) — with the canon list this file deliberately does not pass.
    //
    // So NO_CANON here is the point, not an oversight: it shows the pre-#1180
    // answer surviving exactly where the new rule is inert, and it is why this
    // assertion cannot go red on a #1180 regression. The tests that do are in
    // `resolveProductForm.test.ts` and the flow suite in
    // `apps/cloud-functions/tests/flows/canonicaliseRecipeIngredients.proposal.test.ts`.
    const forms = [form({ id: 'lemon-zest', label: 'Zest', parentCanonId: 'canon-lemon' })];
    expect(resolveProductForm('zest of 1 lime', forms, NO_CANON)?.parentCanonId).toBe(
      'canon-lemon',
    );
    expect(
      resolveProductForm('zest of 1 lime', forms, [
        { id: 'canon-lemon', name: 'Lemon' },
        { id: 'canon-lime', name: 'Lime' },
      ]),
    ).toBeNull();
  });
});
