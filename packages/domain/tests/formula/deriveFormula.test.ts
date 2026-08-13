import { describe, it, expect } from 'vitest';
import {
  basisYield,
  deriveFormula,
  solveFormula,
  unitShapeFromPreset,
  unitShapePreset,
  UNIT_SHAPE_PRESETS,
} from '../../src/index.js';

describe('deriveFormula', () => {
  it('refuses a formula with nothing in it', () => {
    const derived = deriveFormula({ recipeId: 'r1', components: [] });
    expect(derived).toEqual({ ok: false, reason: { kind: 'emptyFormula' } });
  });

  it('refuses a gram figure that cannot start a derivation, and names the ingredient', () => {
    const derived = deriveFormula({
      recipeId: 'r1',
      components: [
        { ingredientId: 'ing-flour', grams: 500, inBasis: true },
        { ingredientId: 'ing-water', grams: 0, inBasis: false },
      ],
    });
    expect(derived).toEqual({
      ok: false,
      reason: { kind: 'invalidAmount', ingredientId: 'ing-water', grams: 0 },
    });
  });

  it('refuses when nothing was chosen as the basis', () => {
    const derived = deriveFormula({
      recipeId: 'r1',
      components: [{ ingredientId: 'ing-water', grams: 350, inBasis: false }],
    });
    expect(derived).toEqual({ ok: false, reason: { kind: 'noBasis' } });
  });

  it('carries density provenance and bounds through onto the component', () => {
    const derived = deriveFormula({
      recipeId: 'r1',
      components: [
        { ingredientId: 'ing-flour', grams: 500, inBasis: true },
        { ingredientId: 'ing-oil', grams: 46, inBasis: false, density: 'oil', maxPercent: 12 },
      ],
    });
    if (!derived.ok) throw new Error(derived.reason.kind);
    expect(derived.formula.components[1]).toEqual({
      ingredientId: 'ing-oil',
      percent: 9.2,
      inBasis: false,
      density: 'oil',
      maxPercent: 12,
    });
  });

  it('leaves absent optional fields absent rather than writing undefined', () => {
    const derived = deriveFormula({
      recipeId: 'r1',
      components: [{ ingredientId: 'ing-flour', grams: 500, inBasis: true }],
    });
    if (!derived.ok) throw new Error(derived.reason.kind);
    expect(Object.keys(derived.formula.components[0] ?? {}).sort()).toEqual([
      'inBasis',
      'ingredientId',
      'percent',
    ]);
  });

  it('takes a caller-supplied reference yield over the derived basis weight', () => {
    const preset = unitShapePreset('tin-loaf-900');
    if (preset === null) throw new Error('missing preset');
    const derived = deriveFormula({
      recipeId: 'r1',
      components: [
        { ingredientId: 'ing-flour', grams: 500, inBasis: true },
        { ingredientId: 'ing-water', grams: 350, inBasis: false },
      ],
      referenceYield: { kind: 'target', shape: unitShapeFromPreset(preset, 1) },
    });
    if (!derived.ok) throw new Error(derived.reason.kind);
    expect(derived.formula.referenceYield.kind).toBe('target');
  });

  it('defaults to no handling loss', () => {
    const derived = deriveFormula({
      recipeId: 'r1',
      components: [{ ingredientId: 'ing-flour', grams: 500, inBasis: true }],
    });
    if (!derived.ok) throw new Error(derived.reason.kind);
    expect(derived.formula.handlingLossPercent).toBe(0);
    const solved = solveFormula(derived.formula, basisYield(500));
    if (!solved.ok) throw new Error(solved.reason.kind);
    expect(solved.solution.usableGrams).toBe(solved.solution.totalGrams);
  });
});

describe('unit shapes', () => {
  it('is data — a preset plus the count you are making today', () => {
    const preset = unitShapePreset('roll-120');
    if (preset === null) throw new Error('missing preset');
    expect(unitShapeFromPreset(preset, 12)).toEqual({
      label: '120 g roll',
      count: 12,
      unitDoughGrams: 120,
      bakeLossPercent: 10,
    });
  });

  it('has no preset for an id nobody ships', () => {
    expect(unitShapePreset('brioche-a-tete-45')).toBeNull();
  });

  it('states dough weight and a bake loss for every preset', () => {
    for (const preset of UNIT_SHAPE_PRESETS) {
      expect(preset.unitDoughGrams).toBeGreaterThan(0);
      expect(preset.bakeLossPercent).toBeGreaterThan(0);
      expect(preset.bakeLossPercent).toBeLessThan(100);
    }
  });
});
