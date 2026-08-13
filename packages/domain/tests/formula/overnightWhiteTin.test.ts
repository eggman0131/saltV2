import { describe, it, expect } from 'vitest';
import {
  deriveFormula,
  solveFormula,
  targetYield,
  unitShapeFromPreset,
  unitShapePreset,
} from '../../src/index.js';
import type { Formula } from '../../src/schemas/index.js';

// #778's worked example, in real bread rather than fixtures: the overnight white
// tin loaf as it exists in Salt today, asked for twelve 120 g rolls instead.
//
//   strong white flour  500 g  100%  ← basis
//   water               350 g   70%
//   salt                 10 g    2%
//   instant yeast         7 g  1.4%
//   olive oil            15 g    3%
//
// Every figure below is checkable by hand. If the suite says 841 g and you make
// it 840 g on paper, one of us is wrong — and it is visible before anything is
// built on top.

const FLOUR = 'ing-strong-white-flour';
const WATER = 'ing-water';
const SALT = 'ing-salt';
const YEAST = 'ing-instant-yeast';
const OIL = 'ing-olive-oil';

// 3% for what stays in the bowl and on the bench.
const HANDLING_LOSS_PERCENT = 3;

function overnightWhiteTin(): Formula {
  const derived = deriveFormula({
    recipeId: 'overnight-white-tin',
    components: [
      { ingredientId: FLOUR, grams: 500, inBasis: true },
      { ingredientId: WATER, grams: 350, inBasis: false },
      { ingredientId: SALT, grams: 10, inBasis: false },
      { ingredientId: YEAST, grams: 7, inBasis: false },
      { ingredientId: OIL, grams: 15, inBasis: false },
    ],
    handlingLossPercent: HANDLING_LOSS_PERCENT,
  });
  if (!derived.ok) throw new Error(`fixture failed to derive: ${derived.reason.kind}`);
  return derived.formula;
}

function gramsById(
  solution: { components: { ingredientId: string; grams: number }[] },
  ingredientId: string,
): number {
  const component = solution.components.find((c) => c.ingredientId === ingredientId);
  if (component === undefined) throw new Error(`no component ${ingredientId}`);
  return component.grams;
}

describe('overnight white tin loaf — derivation', () => {
  it('reads the loaf as baker’s percentages against the flour', () => {
    const formula = overnightWhiteTin();
    const percentById = Object.fromEntries(
      formula.components.map((c) => [c.ingredientId, c.percent]),
    );

    expect(percentById[FLOUR]).toBe(100);
    expect(percentById[WATER]).toBe(70);
    expect(percentById[SALT]).toBe(2);
    // 7 / 500 × 100 is 1.4000000000000001 in IEEE 754 — the reason percentages
    // are rounded on derivation rather than persisted raw.
    expect(percentById[YEAST]).toBe(1.4);
    expect(percentById[OIL]).toBe(3);
  });

  it('records the basis weight it was derived at as the reference yield', () => {
    // No caller said what the recipe as written makes, so the honest reference is
    // "these ratios came from this much flour".
    expect(overnightWhiteTin().referenceYield).toEqual({ kind: 'basis', grams: 500 });
  });

  it('resolves back to the recipe it came from at its own reference yield', () => {
    const solved = solveFormula(overnightWhiteTin());
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;

    expect(gramsById(solved.solution, FLOUR)).toBe(500);
    expect(gramsById(solved.solution, WATER)).toBe(350);
    expect(gramsById(solved.solution, SALT)).toBe(10);
    expect(gramsById(solved.solution, YEAST)).toBe(7);
    expect(gramsById(solved.solution, OIL)).toBe(15);
    // 500 g of flour at 176.4% is 882 g in the bowl.
    expect(solved.solution.totalGrams).toBe(882);
  });
});

describe('overnight white tin loaf — 12 rolls at 120 g each', () => {
  const rollPreset = unitShapePreset('roll-120');
  if (rollPreset === null) throw new Error('missing roll preset');
  const twelveRolls = targetYield(unitShapeFromPreset(rollPreset, 12));

  it('answers with the worked example, to the gram', () => {
    const solved = solveFormula(overnightWhiteTin(), twelveRolls);
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    const { solution } = solved;

    // 1 440 g of dough on the bench, +3% for handling = 1 483 g mixed;
    // 1 483.2 ÷ 1.764 = 840.8 g of flour.
    expect(gramsById(solution, FLOUR)).toBe(841);
    expect(gramsById(solution, WATER)).toBe(589);
    expect(gramsById(solution, SALT)).toBe(17);
    expect(gramsById(solution, YEAST)).toBe(12);
    expect(gramsById(solution, OIL)).toBe(25);

    expect(solution.basisGrams).toBe(841);
    expect(solution.totalGrams).toBe(1483);
    expect(solution.usableGrams).toBe(1440);
  });

  it('shows what comes out of the oven beside what goes on the bench', () => {
    const solved = solveFormula(overnightWhiteTin(), twelveRolls);
    if (!solved.ok) throw new Error(solved.reason.kind);

    expect(solved.solution.units).toEqual({
      label: '120 g roll',
      count: 12,
      unitDoughGrams: 120,
      // 120 g of dough at 10% bake loss. "120 g rolls" is dough weight; nobody
      // should be surprised by a 108 g roll.
      bakedUnitGrams: 108,
      bakedUnitExactGrams: 108,
    });
  });

  it('keeps the deliberate 1 g gap between the summed parts and the solved total', () => {
    const solved = solveFormula(overnightWhiteTin(), twelveRolls);
    if (!solved.ok) throw new Error(solved.reason.kind);
    const { solution } = solved;

    const summedParts = solution.components.reduce((sum, c) => sum + c.grams, 0);
    // 841 + 589 + 17 + 12 + 25 = 1 484, against a solved total of 1 483.
    expect(summedParts).toBe(1484);
    expect(solution.totalGrams).toBe(1483);
    expect(summedParts - solution.totalGrams).toBe(1);

    // Intended, not tolerated: the total is SOLVED, not summed. Reconciling by
    // largest remainder would make one component's figure depend on the others,
    // which is surprising when you edit a single percentage — and the batch, the
    // shopping list and the screen would each need the same rule.
    expect(solution.totalExactGrams).toBeCloseTo(1483.2, 6);
    const summedExact = solution.components.reduce((sum, c) => sum + c.exactGrams, 0);
    expect(summedExact).toBeCloseTo(solution.totalExactGrams, 6);
  });

  it('carries the exact float beside every rounded figure', () => {
    const solved = solveFormula(overnightWhiteTin(), twelveRolls);
    if (!solved.ok) throw new Error(solved.reason.kind);
    const { solution } = solved;

    expect(solution.basisExactGrams).toBeCloseTo(840.8163265306122, 9);
    const salt = solution.components.find((c) => c.ingredientId === SALT);
    expect(salt?.exactGrams).toBeCloseTo(16.816326530612244, 9);
    expect(salt?.grams).toBe(17);
  });
});

describe('overnight white tin loaf — a 70/30 second-tier basis', () => {
  // Same loaf, same reference, the flour split 350 g strong white / 150 g
  // wholemeal. The second tier is what lets one model cover bread, kraut and a
  // coppa; the additions are percentages of the flour TOTAL, so nothing about
  // them changes.
  const WHOLEMEAL = 'ing-wholemeal-flour';

  function splitBasisLoaf(): Formula {
    const derived = deriveFormula({
      recipeId: 'overnight-70-30-tin',
      components: [
        { ingredientId: FLOUR, grams: 350, inBasis: true },
        { ingredientId: WHOLEMEAL, grams: 150, inBasis: true },
        { ingredientId: WATER, grams: 350, inBasis: false },
        { ingredientId: SALT, grams: 10, inBasis: false },
        { ingredientId: YEAST, grams: 7, inBasis: false },
        { ingredientId: OIL, grams: 15, inBasis: false },
      ],
      handlingLossPercent: HANDLING_LOSS_PERCENT,
    });
    if (!derived.ok) throw new Error(`fixture failed to derive: ${derived.reason.kind}`);
    return derived.formula;
  }

  it('splits the basis 70/30 and still totals 100%', () => {
    const formula = splitBasisLoaf();
    const basis = formula.components.filter((c) => c.inBasis);
    expect(basis.map((c) => c.percent)).toEqual([70, 30]);
    expect(basis.reduce((sum, c) => sum + c.percent, 0)).toBe(100);
  });

  it('resolves against the same reference as the single-flour loaf', () => {
    const rollPreset = unitShapePreset('roll-120');
    if (rollPreset === null) throw new Error('missing roll preset');
    const solved = solveFormula(splitBasisLoaf(), targetYield(unitShapeFromPreset(rollPreset, 12)));
    if (!solved.ok) throw new Error(solved.reason.kind);
    const { solution } = solved;

    // 840.8 g of flour, split: 588.6 → 589 g white, 252.2 → 252 g wholemeal.
    expect(gramsById(solution, FLOUR)).toBe(589);
    expect(gramsById(solution, WHOLEMEAL)).toBe(252);
    expect(solution.basisGrams).toBe(841);

    // The additions are untouched by how the flour is split.
    expect(gramsById(solution, WATER)).toBe(589);
    expect(gramsById(solution, SALT)).toBe(17);
    expect(gramsById(solution, YEAST)).toBe(12);
    expect(gramsById(solution, OIL)).toBe(25);
    expect(solution.totalGrams).toBe(1483);
  });
});
