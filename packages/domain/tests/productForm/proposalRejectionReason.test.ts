import { describe, it, expect } from 'vitest';
import { proposalRejectionReason } from '../../src/productForm/index.js';
import type { ProductFormProposal } from '../../src/schemas/productFormArbitration.js';

function proposal(over: Partial<Extract<ProductFormProposal, { kind: 'form' }>> = {}) {
  return {
    kind: 'form' as const,
    parentName: 'Lime',
    matcher: 'lime juice',
    label: 'Lime juice',
    formUnit: 'ml' as const,
    amountPerParent: 30,
    ...over,
  };
}

describe('proposalRejectionReason', () => {
  it('passes a genuine conversion between two different things', () => {
    expect(proposalRejectionReason(proposal(), ['Mayonnaise'])).toBeNull();
  });

  it('never rejects a "none" proposal', () => {
    expect(proposalRejectionReason({ kind: 'none' }, ['Chicken Stock'])).toBeNull();
  });

  describe('self_reference', () => {
    it('rejects a form whose label names its own parent', () => {
      // Observed in production: `Garlic sauce -> Garlic Sauce`, yield 50 ml per
      // parent. Converting a thing into itself carries no information.
      expect(
        proposalRejectionReason(
          proposal({
            parentName: 'Garlic Sauce',
            label: 'Garlic sauce',
            matcher: 'leftover garlic sauce',
          }),
        ),
      ).toBe('self_reference');
    });

    it('rejects a form whose matcher names its own parent', () => {
      expect(
        proposalRejectionReason(proposal({ parentName: 'Beef Mince', matcher: 'beef mince' })),
      ).toBe('self_reference');
    });

    // The first version of this check compared the two names for equality, and
    // production walked straight through it twice: the model labelled the form
    // "Leftover garlic sauce" over parent "Garlic Sauce", and "Warm water" over
    // "Water". A qualifier on the front does not make a new thing.
    it('rejects a label that only QUALIFIES its parent', () => {
      expect(
        proposalRejectionReason(
          proposal({
            parentName: 'Garlic Sauce',
            label: 'Leftover garlic sauce',
            matcher: 'leftover garlic sauce',
          }),
        ),
      ).toBe('self_reference');
    });

    it('rejects a one-word parent qualified into a phrase', () => {
      expect(
        proposalRejectionReason(
          proposal({ parentName: 'Water', label: 'Warm water', matcher: 'warm water' }),
        ),
      ).toBe('self_reference');
    });

    // A PREPARATION is not a form. Grated nutmeg is nutmeg, chopped onion is
    // onion — nothing became anything else, so there is no conversion to state.
    // Admitting these would admit every preparation verb in the language against
    // every parent, which is the floodgate this rule closes.
    it.each([
      ['Nutmeg', 'Grated nutmeg'],
      ['Onions', 'Chopped onion'],
      ['Basmati Rice', 'Cooked rice'],
    ])('rejects the preparation %s -> %s', (parentName, label) => {
      expect(proposalRejectionReason(proposal({ parentName, label }))).toBe('self_reference');
    });

    // The rule is "same head noun", not "the parent appears somewhere in the
    // label". Plain containment would reject every real form, because a form is
    // almost always named after the thing it comes from.
    it.each([
      ['Lime', 'Lime juice'],
      ['Lemon', 'Lemon zest'],
      ['Eggs', 'Egg yolk'],
      ['Garlic Bulb', 'Garlic clove'],
      ['Whole Chicken', 'Chicken breast'],
      ['Beetroot', 'Beetroot brine'],
    ])('allows the real derivative %s -> %s', (parentName, label) => {
      expect(proposalRejectionReason(proposal({ parentName, label }))).toBeNull();
    });

    // A matcher is ingredient text as a recipe wrote it, not a tidy noun phrase.
    // "juice of 1 lime" normalises to "juice of lime", so its last token is the
    // parent — which is why the head-noun test is never applied to the matcher.
    it('does not read a trailing parent in the MATCHER as a self-reference', () => {
      expect(
        proposalRejectionReason(
          proposal({ parentName: 'Lime', label: 'Lime juice', matcher: 'juice of 1 lime' }),
        ),
      ).toBeNull();
    });

    it('folds case and spacing like every other name comparison', () => {
      expect(
        proposalRejectionReason(
          proposal({ parentName: '  CHICKEN   Stock ', label: 'chicken stock' }),
        ),
      ).toBe('self_reference');
    });
  });

  describe('has_producer', () => {
    it('rejects a form for something a recipe already produces', () => {
      // The production failure this exists for: with no stock-cube canon to pick,
      // arbitration parented "chicken stock" onto Whole Chicken at 500 ml per
      // bird, which put chickens on the shopping list in place of stock.
      expect(
        proposalRejectionReason(
          proposal({
            parentName: 'Whole Chicken',
            matcher: 'chicken stock',
            label: 'Chicken stock',
          }),
          ['Chicken Stock', 'Mayonnaise', 'Soft Burger Bun'],
        ),
      ).toBe('has_producer');
    });

    it('allows a form whose PARENT is produced, only the form itself is barred', () => {
      // "Soft Bread Rolls" produces Soft Burger Bun, but a real conversion FROM a
      // burger bun would still be a legitimate form.
      expect(
        proposalRejectionReason(
          proposal({
            parentName: 'Soft Burger Bun',
            matcher: 'burger bun crumb',
            label: 'Bun crumb',
          }),
          ['Soft Burger Bun'],
        ),
      ).toBeNull();
    });

    it('is disabled by an empty produced list, so an unreadable recipe list degrades to today', () => {
      expect(
        proposalRejectionReason(
          proposal({
            parentName: 'Whole Chicken',
            matcher: 'chicken stock',
            label: 'Chicken stock',
          }),
        ),
      ).toBeNull();
    });
  });

  // Issue #1180, mechanism 2 — the write path.
  describe('label_omits_parent', () => {
    it('rejects a bare component word as a label', () => {
      // The reported defect at its source. `resolveProductForm` matches a form's
      // LABEL on equal terms with its matchers (#818), so `Zest` stored on Lime
      // would be a matching phrase naming no parent — it claims every parent's
      // zest. The matcher here is perfectly good; the label is the problem.
      expect(
        proposalRejectionReason(
          proposal({ parentName: 'Lime', label: 'Zest', matcher: 'lime zest' }),
        ),
      ).toBe('label_omits_parent');
    });

    it('accepts the same proposal once the label names its parent', () => {
      expect(
        proposalRejectionReason(
          proposal({ parentName: 'Lime', label: 'Lime zest', matcher: 'lime zest' }),
        ),
      ).toBeNull();
    });

    it('reports a more specific reason first', () => {
      // A proposal can be wrong twice. `has_producer` and `self_reference` both
      // say something about what the form IS; this rule only says its name is
      // unusable. The specific answer is the one worth logging.
      expect(
        proposalRejectionReason(
          proposal({ parentName: 'Whole Chicken', label: 'Stock', matcher: 'chicken stock' }),
          ['Stock'],
        ),
      ).toBe('has_producer');
    });

    it('judges nothing when either name normalises away', () => {
      // Rule 10 in miniature: no evidence, no refusal.
      expect(proposalRejectionReason(proposal({ parentName: '400', label: 'Zest' }))).toBeNull();
      expect(proposalRejectionReason(proposal({ parentName: 'Lime', label: '2' }))).toBeNull();
    });

    // The 16 labels in the live `productForms` table, read from staging
    // `s2-stage-ccb22` on 2026-09-02 (refreshed wholesale from production on
    // 2026-08-30), each against its real parent's canon name. Fifteen clear the
    // rule. This is what makes "the rule would not have blocked the table we
    // actually have" mechanical rather than asserted (Hard rule 12).
    it.each([
      ['Fermented beetroot brine', 'Beetroot'],
      ['Beef Stock', 'Beef Stock Cube'],
      ['chicken breast', 'Whole Chicken'],
      ['Fresh lemon juice', 'Lemon'],
      ['garlic clove', 'Garlic Bulbs'],
      ['Cheddar cheese slice', 'Mature Cheddar'],
      ['Chicken carcass', 'Whole Chicken'],
      ['Egg yolk', 'Eggs'],
      ['Chicken Drumstick', 'Whole Chicken'],
      ['Olive oil from jar', 'Delicatessen Olives'],
      ['Lime juice', 'Lime'],
      ['Lemon zest', 'Lemon'],
      ['Lime zest', 'Lime'],
      ['Chicken thigh', 'Whole Chicken'],
      ['Chicken Leg', 'Whole Chicken'],
    ])('live label %j on parent %j is not rejected', (label, parentName) => {
      expect(proposalRejectionReason(proposal({ label, parentName }))).toBeNull();
    });

    it('the one live label it would reject — Active whey on Plain Yogurt', () => {
      // Correct on this rule's own terms and harmless in fact: the rule gates AI
      // PROPOSALS only, no stored document is re-validated, and this row was
      // authored by an admin who knew what they meant. Pinned so the exception
      // is a measured fact rather than a sentence in a PR body — and so that a
      // later softening of the rule shows up here as a deliberate change.
      expect(
        proposalRejectionReason(proposal({ label: 'Active whey', parentName: 'Plain Yogurt' })),
      ).toBe('label_omits_parent');
    });
  });
});
