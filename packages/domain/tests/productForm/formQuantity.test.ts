import { describe, it, expect } from 'vitest';
import { formParentCount, maxCountWinners } from '@salt/domain';
import type { ProductForm } from '@salt/domain';

const juice: ProductForm = {
  id: 'pf-juice',
  schemaVersion: 1,
  matchers: ['lime juice'],
  parentCanonId: 'canon-lime',
  label: 'freshly squeezed lime juice',
  yield: { formUnit: 'ml', amountPerParent: 30 },
  updatedAt: '',
};

const zest: ProductForm = {
  ...juice,
  id: 'pf-zest',
  matchers: ['lime zest'],
  label: 'lime zest',
  // one lime yields one lot of zest → a count-based yield
  yield: { formUnit: 'count', amountPerParent: 1 },
};

describe('formParentCount', () => {
  it('converts and rounds a matching unit to a whole count', () => {
    expect(formParentCount(90, 'ml', juice)).toBe(3);
  });

  it('rounds to nearest whole', () => {
    expect(formParentCount(70, 'ml', juice)).toBe(2); // 2.33 → 2
    expect(formParentCount(80, 'ml', juice)).toBe(3); // 2.66 → 3
  });

  it('a positive amount below one parent rounds up to 1', () => {
    expect(formParentCount(5, 'ml', juice)).toBe(1); // 0.16 → 1, never 0
  });

  it('degrades to identity (null) on a unit mismatch', () => {
    // "juice of 2 limes": a count against an ml yield — no ml to convert.
    expect(formParentCount(2, 'count', juice)).toBeNull();
    expect(formParentCount(100, 'g', juice)).toBeNull();
  });

  it('matches a count yield against a count ingredient', () => {
    expect(formParentCount(2, 'count', zest)).toBe(2);
  });

  it('degrades to identity (null) on a degenerate yield', () => {
    const bad: ProductForm = { ...juice, yield: { formUnit: 'ml', amountPerParent: 0 } };
    expect(formParentCount(90, 'ml', bad)).toBeNull();
  });
});

describe('maxCountWinners', () => {
  it('picks the max count per parent, not the sum (one lime → juice AND zest)', () => {
    const winners = maxCountWinners([
      { parentCanonId: 'canon-lime', count: 3 }, // juice
      { parentCanonId: 'canon-lime', count: 2 }, // zest
    ]);
    expect(winners.get('canon-lime')).toBe(0); // the count-3 row wins
    expect(winners.size).toBe(1);
  });

  it('ties keep the first entry', () => {
    const winners = maxCountWinners([
      { parentCanonId: 'canon-lime', count: 2 },
      { parentCanonId: 'canon-lime', count: 2 },
    ]);
    expect(winners.get('canon-lime')).toBe(0);
  });

  it('single-recipe chicken jointing: MAX(thighs 2, drumsticks 1) keeps the thigh row (#500/#501)', () => {
    // Pins the per-recipe MAX buildRecipeAddPlan relies on: one recipe needing
    // 4 thighs (→2) AND 2 drumsticks (→1) buys 2 birds, not 3. Must stay MAX.
    const winners = maxCountWinners([
      { parentCanonId: 'canon-chicken', count: 2 }, // thighs
      { parentCanonId: 'canon-chicken', count: 1 }, // drumsticks
    ]);
    expect(winners.get('canon-chicken')).toBe(0); // the count-2 (thigh) row wins
    expect(winners.size).toBe(1);
  });

  it('keeps distinct parents independently', () => {
    const winners = maxCountWinners([
      { parentCanonId: 'canon-lime', count: 1 },
      { parentCanonId: 'canon-lemon', count: 5 },
    ]);
    expect(winners.get('canon-lime')).toBe(0);
    expect(winners.get('canon-lemon')).toBe(1);
  });
});
