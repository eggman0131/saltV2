import { describe, it, expect } from 'vitest';
import { takesIngredients, isCookable, isPlannable } from '@salt/domain';
import type { RecipeKind } from '@salt/domain';

// The capability table (issue #637), pinned cell by cell. This is the contract
// every screen inherits: nothing outside packages/domain branches on the kind,
// so if a cell here is wrong the whole app is wrong in the same way.
describe('recipe kind capabilities', () => {
  const table: ReadonlyArray<{
    kind: RecipeKind;
    takesIngredients: boolean;
    isCookable: boolean;
    isPlannable: boolean;
  }> = [
    { kind: 'recipe', takesIngredients: true, isCookable: true, isPlannable: true },
    { kind: 'outing', takesIngredients: false, isCookable: false, isPlannable: true },
    { kind: 'cocktail', takesIngredients: true, isCookable: true, isPlannable: false },
    { kind: 'placeholder', takesIngredients: false, isCookable: false, isPlannable: false },
  ];

  for (const row of table) {
    it(`${row.kind}: ingredients ${row.takesIngredients}, cookable ${row.isCookable}, plannable ${row.isPlannable}`, () => {
      expect(takesIngredients(row.kind)).toBe(row.takesIngredients);
      expect(isCookable(row.kind)).toBe(row.isCookable);
      expect(isPlannable(row.kind)).toBe(row.isPlannable);
    });
  }

  it('an outing is the only kind that is eaten rather than made', () => {
    // Named separately from the table because it is the distinction the whole
    // feature exists for: an outing fills a planner slot with nothing to buy or do.
    expect(isPlannable('outing')).toBe(true);
    expect(takesIngredients('outing')).toBe(false);
    expect(isCookable('outing')).toBe(false);
  });

  it('a cocktail is made like a recipe but is never dinner', () => {
    expect(takesIngredients('cocktail')).toBe(true);
    expect(isCookable('cocktail')).toBe(true);
    expect(isPlannable('cocktail')).toBe(false);
  });

  it('a placeholder can do nothing at all — it is a photograph and a title', () => {
    // Named separately because every one of these `false`s is load-bearing
    // somewhere (issue #652): nothing to buy, nothing to cook, and — the one that
    // reads oddly until you know why — never offered in the planner picker, even
    // though it is the only kind that reaches a planner day WITHOUT being picked.
    expect(takesIngredients('placeholder')).toBe(false);
    expect(isCookable('placeholder')).toBe(false);
    expect(isPlannable('placeholder')).toBe(false);
  });
});
