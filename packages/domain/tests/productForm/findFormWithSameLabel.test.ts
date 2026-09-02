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

  it('KNOWN LIMIT — resolveProductForm still crosses parents on a bare-noun label', () => {
    // The boundary of the claim above, pinned rather than left to a header
    // sentence (CLAUDE.md Hard rule 12). Scoping THIS query does not make
    // product-form binding parent-safe in general: `resolveProductForm` matches
    // on `[form.label, ...form.matchers]`, so a bare-noun label is itself a
    // global, parent-blind matching phrase — and it is the query the recipe
    // canonicalisation flow reaches first. Follow-up issue #1180 owns that;
    // when it lands this expectation flips, which is the signal to widen the
    // boundary paragraph in this query's header.
    //
    // WEAKER THAN IT READS (PR #1181 review, note). The only assertion that
    // actually pins the limit is the `resolveProductForm` one below —
    // `findFormWithSameLabel` is on #1180's must-not-touch list, so an
    // assertion against it here could never go red on that follow-up landing,
    // and this file dropped the earlier one for exactly that reason. Nor does
    // this test's own typing catch #1180 widening `resolveProductForm` to a
    // required third (canon-list) parameter: `packages/domain/tsconfig.json`
    // only includes `src/**/*`, so this file is never typechecked, and a
    // missing required argument is a compile error, not a runtime one — this
    // two-arg call goes red only if #1180's implementation happens to throw on
    // an absent third argument rather than treating it as an empty list. The
    // CF `KNOWN LIMIT` case in
    // `apps/cloud-functions/tests/flows/canonicaliseRecipeIngredients.proposal.test.ts`,
    // which drives the real flow through the compiled call site, is the pin
    // that actually fires; this one is a weaker, best-effort second.
    const forms = [form({ id: 'lemon-zest', label: 'Zest', parentCanonId: 'canon-lemon' })];
    expect(resolveProductForm('zest of 1 lime', forms)?.parentCanonId).toBe('canon-lemon');
  });
});
