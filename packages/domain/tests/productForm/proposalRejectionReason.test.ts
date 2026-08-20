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
});
