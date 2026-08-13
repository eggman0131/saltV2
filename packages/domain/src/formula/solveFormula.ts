import type { Formula, FormulaComponent, ReferenceYield } from '../schemas/formula.js';
import type { BoundViolation, FormulaFailure } from './failure.js';
import { roundGrams } from './rounding.js';

// The bidirectional yield solve (issue #782). One equation, two unknowns you can
// choose between:
//
//   total = basis × (Σ all percentages ÷ 100)
//
//   - target-driven (bread): "12 × 120 g rolls" is known → solve for basis.
//   - basis-driven (ferments, cures): the meat weighs 2.4 kg → solve for total.
//
// Both ship together and neither is privileged in the types, because building the
// target direction alone bakes "yield is the input" into the shape and is awkward
// to unpick — the same argument the contract doc makes.

// Basis percentages are compared to 100 with this tolerance, in percentage
// points. Derived percentages are rounded to four decimals, so a three-way basis
// split lands at 99.9999 and must not be refused.
export const BASIS_PERCENT_TOLERANCE = 0.01;

export type SolvedComponent = {
  ingredientId: string;
  percent: number;
  // What you weigh, through the one rounding authority.
  grams: number;
  // The same figure unrounded, for anything that needs to compute rather than
  // display — and so no caller ever needs to re-derive it and round differently.
  exactGrams: number;
};

export type SolvedUnits = {
  label: string;
  count: number;
  // DOUGH weight per unit — what you scale onto the bench, echoed back from the
  // shape so a caller holding only the solution can still label it.
  unitDoughGrams: number;
  // What comes out of the oven, after `bakeLossPercent`. Shown alongside so a
  // "120 g roll" does not surprise anyone at 108 g.
  bakedUnitGrams: number;
  bakedUnitExactGrams: number;
};

export type FormulaSolution = {
  // The 100%: the flours, the vegetables, the green weight.
  basisGrams: number;
  basisExactGrams: number;
  // Everything weighed into the bowl, including the handling allowance.
  totalGrams: number;
  totalExactGrams: number;
  // What survives handling and is actually portioned. Equals the total when the
  // formula declares no handling loss.
  usableGrams: number;
  usableExactGrams: number;
  components: SolvedComponent[];
  // Null for a basis-driven solve: weighing the meat says nothing about how many
  // of anything you end up with.
  units: SolvedUnits | null;
};

export type SolveFormulaResult =
  { ok: true; solution: FormulaSolution } | { ok: false; reason: FormulaFailure };

function boundViolationsIn(components: readonly FormulaComponent[]): BoundViolation[] {
  const violations: BoundViolation[] = [];
  for (const component of components) {
    const { ingredientId, percent, minPercent, maxPercent } = component;
    // Both declared bounds ride along on either violation, so a caller can show
    // the window that was missed rather than just the edge that was hit.
    const declared = {
      ...(minPercent !== undefined ? { minPercent } : {}),
      ...(maxPercent !== undefined ? { maxPercent } : {}),
    };
    if (minPercent !== undefined && percent < minPercent) {
      violations.push({ ingredientId, percent, bound: 'min', ...declared });
    } else if (maxPercent !== undefined && percent > maxPercent) {
      violations.push({ ingredientId, percent, bound: 'max', ...declared });
    }
  }
  return violations;
}

/**
 * Resolve a formula's percentages into grams at a given yield.
 *
 * The yield defaults to the formula's own `referenceYield`, which is the same
 * type — asking for "the recipe as written" and asking for twelve rolls are the
 * same call with a different argument.
 *
 * Pure and total: no clock, no I/O, no throw, and never a NaN or a negative gram
 * figure — anything that would produce one comes back as a typed failure instead.
 */
export function solveFormula(
  formula: Formula,
  atYield: ReferenceYield = formula.referenceYield,
): SolveFormulaResult {
  const { components, handlingLossPercent } = formula;

  if (components.length === 0) return { ok: false, reason: { kind: 'emptyFormula' } };

  const basisComponents = components.filter((component) => component.inBasis);
  if (basisComponents.length === 0) return { ok: false, reason: { kind: 'noBasis' } };

  const sumBasisPercent = basisComponents.reduce((sum, c) => sum + c.percent, 0);
  if (Math.abs(sumBasisPercent - 100) > BASIS_PERCENT_TOLERANCE) {
    return { ok: false, reason: { kind: 'basisNotNormalised', sumPercent: sumBasisPercent } };
  }

  // Bounds are checked against the stored percentages, which is the whole point:
  // scaling is linear, so a percentage that is unsafe at 500 g of flour is unsafe
  // at 841 g. The solve refuses to hand out grams at all rather than extrapolate.
  const violations = boundViolationsIn(components);
  if (violations.length > 0) {
    return { ok: false, reason: { kind: 'boundViolation', violations } };
  }

  const sumAllPercent = components.reduce((sum, c) => sum + c.percent, 0);

  // Handling loss is an allowance ADDED to what you need (×1.03 at 3%), not a
  // divisor (÷0.97). It is the way a baker actually scales up for what stays in
  // the bowl, it is what #778's worked example asserts to the gram, and — the part
  // that matters here — it makes the two directions exact inverses of each other:
  // usable × allowance = total, total ÷ allowance = usable.
  const handlingAllowance = 1 + handlingLossPercent / 100;

  let basisExactGrams: number;
  let totalExactGrams: number;
  let usableExactGrams: number;
  let units: SolvedUnits | null = null;

  if (atYield.kind === 'basis') {
    basisExactGrams = atYield.grams;
    totalExactGrams = basisExactGrams * (sumAllPercent / 100);
    usableExactGrams = totalExactGrams / handlingAllowance;
  } else {
    const { shape } = atYield;
    usableExactGrams = shape.count * shape.unitDoughGrams;
    totalExactGrams = usableExactGrams * handlingAllowance;
    basisExactGrams = totalExactGrams / (sumAllPercent / 100);
    const bakedUnitExactGrams = shape.unitDoughGrams * (1 - shape.bakeLossPercent / 100);
    units = {
      label: shape.label,
      count: shape.count,
      unitDoughGrams: shape.unitDoughGrams,
      bakedUnitGrams: roundGrams(bakedUnitExactGrams),
      bakedUnitExactGrams,
    };
  }

  const derived = [basisExactGrams, totalExactGrams, usableExactGrams];
  if (!derived.every((grams) => Number.isFinite(grams) && grams > 0)) {
    return {
      ok: false,
      reason: {
        kind: 'unsolvableYield',
        detail: `yield resolved to basis ${basisExactGrams} g / total ${totalExactGrams} g`,
      },
    };
  }

  return {
    ok: true,
    solution: {
      basisGrams: roundGrams(basisExactGrams),
      basisExactGrams,
      totalGrams: roundGrams(totalExactGrams),
      totalExactGrams,
      usableGrams: roundGrams(usableExactGrams),
      usableExactGrams,
      components: components.map((component) => {
        const exactGrams = basisExactGrams * (component.percent / 100);
        return {
          ingredientId: component.ingredientId,
          percent: component.percent,
          grams: roundGrams(exactGrams),
          exactGrams,
        };
      }),
      units,
    },
  };
}
