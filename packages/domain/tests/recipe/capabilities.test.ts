import { describe, it, expect } from 'vitest';
import {
  takesIngredients,
  isCookable,
  isPlannable,
  isAuthorable,
  takesComponents,
} from '@salt/domain';
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
    isAuthorable: boolean;
    takesComponents: boolean;
  }> = [
    {
      kind: 'recipe',
      takesIngredients: true,
      isCookable: true,
      isPlannable: true,
      isAuthorable: true,
      takesComponents: true,
    },
    {
      kind: 'outing',
      takesIngredients: false,
      isCookable: false,
      isPlannable: true,
      isAuthorable: false,
      takesComponents: false,
    },
    {
      kind: 'cocktail',
      takesIngredients: true,
      isCookable: true,
      isPlannable: false,
      isAuthorable: false,
      takesComponents: true,
    },
    {
      kind: 'placeholder',
      takesIngredients: false,
      isCookable: false,
      isPlannable: false,
      isAuthorable: false,
      takesComponents: false,
    },
  ];

  for (const row of table) {
    it(`${row.kind}: ingredients ${row.takesIngredients}, cookable ${row.isCookable}, plannable ${row.isPlannable}, authorable ${row.isAuthorable}, components ${row.takesComponents}`, () => {
      expect(takesIngredients(row.kind)).toBe(row.takesIngredients);
      expect(isCookable(row.kind)).toBe(row.isCookable);
      expect(isPlannable(row.kind)).toBe(row.isPlannable);
      expect(isAuthorable(row.kind)).toBe(row.isAuthorable);
      expect(takesComponents(row.kind)).toBe(row.takesComponents);
    });
  }

  it('an outing is the only kind that is eaten rather than made', () => {
    // Named separately from the table because it is the distinction the whole
    // feature exists for: an outing fills a planner slot with nothing to buy or do.
    expect(isPlannable('outing')).toBe(true);
    expect(takesIngredients('outing')).toBe(false);
    expect(isCookable('outing')).toBe(false);
  });

  it('a recipe is the only kind the librarian can author — for now (issue #763)', () => {
    // Named separately because the three `false`s here mean "not yet", not "by
    // design", and the distinction is the whole reason the predicate is called
    // `isAuthorable` rather than something named after a feature. No AI authoring
    // path can emit a non-`recipe` kind today (assembleRecipeDraft hardcodes it),
    // so a cocktail authored from a chat would land in the dinner list forever —
    // `kind` is immutable. The day the librarian carries `kind` through, the
    // cocktail row flips here and every consumer inherits it untouched.
    expect(isAuthorable('recipe')).toBe(true);
    expect(isAuthorable('cocktail')).toBe(false);
    // These two are false on their own merits and stay false: an outing is a
    // hand-written night off, a placeholder is a photograph and a title.
    expect(isAuthorable('outing')).toBe(false);
    expect(isAuthorable('placeholder')).toBe(false);
  });

  it('authorable is not the same question as cookable', () => {
    // The trap this predicate exists to avoid: a cocktail IS cookable, so gating
    // "Make a variation" on `isCookable` would have offered it there.
    expect(isCookable('cocktail')).toBe(true);
    expect(isAuthorable('cocktail')).toBe(false);
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
    expect(takesComponents('placeholder')).toBe(false);
  });

  it('the two kinds you can build a meal out of are exactly the two you can make (issue #752)', () => {
    // Named separately because the list page leans on it: every entry in the Meals
    // section is a `recipe` or a `cocktail`, and both of those take ingredients —
    // which is what makes `sectionTakesIngredients(MEAL_SECTION)` unconditionally
    // true rather than a guess. A meal's ingredients are its OWN; nothing is
    // aggregated from its components.
    expect(takesComponents('recipe')).toBe(true);
    expect(takesComponents('cocktail')).toBe(true);
    expect(takesComponents('outing')).toBe(false);
    expect(takesComponents('placeholder')).toBe(false);
    for (const kind of ['recipe', 'cocktail'] as const) {
      expect(takesIngredients(kind)).toBe(true);
    }
  });

  it('a cocktail takes components — it can point at its own syrup recipe', () => {
    // The row that reads oddly until you know why: a cocktail is never dinner, but
    // it is a dish you MAKE, and a Negroni built on a house syrup is the same
    // relationship a roast has with its gravy.
    expect(isPlannable('cocktail')).toBe(false);
    expect(takesComponents('cocktail')).toBe(true);
  });
});
