import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BAKE_LOSS_PERCENT,
  UNIT_SHAPE_PRESETS,
  bakedUnitGrams,
  solveFormula,
  unitShapeFromPreset,
  targetYield,
} from '../../src/index.js';
import { UnitShapeSchema } from '../../src/schemas/formula.js';
import type { Formula } from '../../src/schemas/formula.js';

// The shape table is pure data, and the only thing that can go wrong with pure
// data is that it stops agreeing with the code that reads it. Three ways it
// could, all cheap to close:
//
//   • a preset the schema would refuse — the picker offers it, the save fails;
//   • two presets sharing an id — the picker resolves the wrong one silently;
//   • a bake-loss figure that isn't a bake loss (a baked weight HEAVIER than the
//     dough, a loss so large the loaf all but vanishes).
//
// Plus the one function two callers share: the screen's declaration and
// `solveFormula`'s `SolvedUnits` must produce the same baked figure, because the
// screen is now where a bake loss is typed and its echo is the only check on it.

describe('UNIT_SHAPE_PRESETS', () => {
  it('offers only shapes the schema would accept', () => {
    for (const preset of UNIT_SHAPE_PRESETS) {
      const parsed = UnitShapeSchema.safeParse(unitShapeFromPreset(preset, 1));
      expect(parsed.success, `${preset.id} is not a valid UnitShape`).toBe(true);
    }
  });

  it('has unique ids and unique labels', () => {
    const ids = UNIT_SHAPE_PRESETS.map((p) => p.id);
    const labels = UNIT_SHAPE_PRESETS.map((p) => p.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('never uses the screen’s reserved custom id', () => {
    // `FormulaPage` adds a `custom` option to this list. A preset claiming that
    // id would make the escape hatch unreachable.
    expect(UNIT_SHAPE_PRESETS.some((p) => p.id === 'custom')).toBe(false);
  });

  it('keeps every bake loss inside the range crust can explain', () => {
    // Loss tracks crust: a boiled bagel at the low end, a baguette at the high.
    // Nothing bread-shaped falls outside this, so a figure that does is a typo.
    for (const preset of UNIT_SHAPE_PRESETS) {
      expect(preset.bakeLossPercent, preset.id).toBeGreaterThanOrEqual(5);
      expect(preset.bakeLossPercent, preset.id).toBeLessThanOrEqual(25);
    }
  });

  it('starts a hand-typed shape at an ordinary domestic figure', () => {
    expect(DEFAULT_BAKE_LOSS_PERCENT).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_BAKE_LOSS_PERCENT).toBeLessThanOrEqual(25);
  });

  it('still holds #778’s worked example — 120 g of dough is about a 108 g roll', () => {
    const roll = UNIT_SHAPE_PRESETS.find((p) => p.id === 'roll-120')!;
    expect(bakedUnitGrams(unitShapeFromPreset(roll, 1))).toBeCloseTo(108, 6);
  });
});

describe('bakedUnitGrams', () => {
  it('is the same figure solveFormula reports for the units it solved', () => {
    // Deliberately a shape the preset list does NOT hold, because that is the
    // case the screen now allows and the one nothing else covers.
    const formula: Formula = {
      recipeId: 'recipe-1',
      components: [
        { ingredientId: 'flour', percent: 100, inBasis: true },
        { ingredientId: 'water', percent: 70, inBasis: false },
      ],
      referenceYield: {
        kind: 'target',
        shape: {
          label: '1 kg sourdough boule',
          count: 2,
          unitDoughGrams: 1000,
          bakeLossPercent: 14,
        },
      },
      handlingLossPercent: 0,
      schemaVersion: 1,
    };
    const shape = { label: 'x', count: 2, unitDoughGrams: 1000, bakeLossPercent: 14 };

    const solved = solveFormula(formula, targetYield(shape));
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.solution.units?.bakedUnitExactGrams).toBe(bakedUnitGrams(shape));
    expect(solved.solution.units?.bakedUnitGrams).toBe(860);
  });

  it('is the dough weight itself when nothing is lost', () => {
    expect(bakedUnitGrams({ unitDoughGrams: 250, bakeLossPercent: 0 })).toBe(250);
  });
});
