import { describe, it, expect } from 'vitest';
import { FormulaSchema } from '../../src/schemas/index.js';
import {
  DensityClassSchema,
  FormulaComponentSchema,
  ReferenceYieldSchema,
  UnitShapeSchema,
} from '../../src/schemas/formula.js';

const MINIMAL_FORMULA = {
  recipeId: 'overnight-white-tin',
  components: [{ ingredientId: 'ing-flour', percent: 100, inBasis: true }],
  referenceYield: { kind: 'basis', grams: 500 },
};

describe('FormulaSchema', () => {
  it('defaults the handling allowance to nothing and stamps the version', () => {
    const parsed = FormulaSchema.parse(MINIMAL_FORMULA);
    expect(parsed.handlingLossPercent).toBe(0);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('accepts a formula with no components — an empty draft is not a parse error', () => {
    // Refusing to SOLVE an empty formula is the solve's job; the document is
    // allowed to exist mid-edit.
    expect(FormulaSchema.safeParse({ ...MINIMAL_FORMULA, components: [] }).success).toBe(true);
  });

  it('accepts a basis that has been edited off 100%', () => {
    // Deliberate: an unnormalised basis is ordinary flow from a human editing
    // percentages, and the solve refuses it with a reason a screen can render.
    // A schema-level refine would instead make the document unreadable.
    const off = {
      ...MINIMAL_FORMULA,
      components: [{ ingredientId: 'ing-flour', percent: 70, inBasis: true }],
    };
    expect(FormulaSchema.safeParse(off).success).toBe(true);
  });
});

describe('FormulaComponentSchema', () => {
  it('rejects a negative percentage', () => {
    expect(
      FormulaComponentSchema.safeParse({ ingredientId: 'i', percent: -1, inBasis: false }).success,
    ).toBe(false);
  });

  it('takes the bound seam as optional, and no bound is set anywhere in this phase', () => {
    const bare = FormulaComponentSchema.parse({ ingredientId: 'i', percent: 2, inBasis: false });
    expect(bare.minPercent).toBeUndefined();
    expect(bare.maxPercent).toBeUndefined();
    expect(
      FormulaComponentSchema.safeParse({
        ingredientId: 'i',
        percent: 2,
        inBasis: false,
        minPercent: 0.2,
        maxPercent: 3,
      }).success,
    ).toBe(true);
  });

  it('rejects a zero upper bound — a bound of nothing is a mistake, not a rail', () => {
    expect(
      FormulaComponentSchema.safeParse({
        ingredientId: 'i',
        percent: 2,
        inBasis: false,
        maxPercent: 0,
      }).success,
    ).toBe(false);
  });
});

describe('UnitShapeSchema', () => {
  it('takes a whole, positive count of a positive dough weight', () => {
    const shape = { label: '120 g roll', count: 12, unitDoughGrams: 120, bakeLossPercent: 10 };
    expect(UnitShapeSchema.safeParse(shape).success).toBe(true);
    expect(UnitShapeSchema.safeParse({ ...shape, count: 0 }).success).toBe(false);
    expect(UnitShapeSchema.safeParse({ ...shape, count: 2.5 }).success).toBe(false);
    expect(UnitShapeSchema.safeParse({ ...shape, unitDoughGrams: 0 }).success).toBe(false);
  });

  it('takes a bake loss as a percentage, not a multiplier', () => {
    const shape = { label: 'x', count: 1, unitDoughGrams: 900, bakeLossPercent: 120 };
    expect(UnitShapeSchema.safeParse(shape).success).toBe(false);
    expect(UnitShapeSchema.safeParse({ ...shape, bakeLossPercent: 0 }).success).toBe(true);
  });
});

describe('ReferenceYieldSchema', () => {
  it('is one type for both directions', () => {
    expect(ReferenceYieldSchema.safeParse({ kind: 'basis', grams: 2400 }).success).toBe(true);
    expect(
      ReferenceYieldSchema.safeParse({
        kind: 'target',
        shape: { label: '120 g roll', count: 12, unitDoughGrams: 120, bakeLossPercent: 10 },
      }).success,
    ).toBe(true);
  });

  it('rejects a yield of nothing and a kind that does not exist', () => {
    expect(ReferenceYieldSchema.safeParse({ kind: 'basis', grams: 0 }).success).toBe(false);
    expect(ReferenceYieldSchema.safeParse({ kind: 'servings', count: 4 }).success).toBe(false);
  });
});

describe('DensityClassSchema', () => {
  it('is a closed set of named classes', () => {
    expect(DensityClassSchema.options).toEqual(['waterLike', 'oil', 'syrup']);
    expect(DensityClassSchema.safeParse('0.92').success).toBe(false);
  });
});
