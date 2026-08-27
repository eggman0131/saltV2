import type { ReferenceYield, UnitShape } from '../schemas/formula.js';

// The shapes a dough gets divided into (issue #782). Pure data: the primitive is
// `count × unitDoughGrams` and is fully general, so this list can grow — or be
// ignored entirely in favour of a hand-entered shape — without the solve changing.
// Both of those escape hatches are now taken: the list below is the shapes worth
// offering, and `FormulaPage` lets a shape be typed when none of them is it.
//
// The bake-loss figures are the phase's one open number: they want a baker's eye
// on them rather than a guess, and #782 says as much. `roll` is fixed by #778's
// worked example (120 g dough → about 108 g baked); the rest are ordinary domestic
// figures and are expected to be tuned once real bakes are logged. The shape of
// the guess is what matters more than any single number: loss tracks crust, so it
// runs from a boiled bagel (8%) through a tinned loaf (12%) to a baguette (18%),
// which is nearly all crust.
//
// The list stays SHAPE FAMILIES, not a catalogue. One entry per thing a dough is
// actually divided into, at the weight that thing is usually made at — a second
// tin loaf 100 g heavier belongs in the custom fields, not here, because a picker
// long enough to need scanning is worse than typing the number.

export type UnitShapePreset = {
  id: string;
  label: string;
  // DOUGH weight per unit — never baked weight.
  unitDoughGrams: number;
  bakeLossPercent: number;
};

export const UNIT_SHAPE_PRESETS: readonly UnitShapePreset[] = [
  { id: 'tin-loaf-900', label: '900 g tin loaf', unitDoughGrams: 900, bakeLossPercent: 12 },
  { id: 'tin-loaf-500', label: '500 g tin loaf', unitDoughGrams: 500, bakeLossPercent: 12 },
  { id: 'boule-800', label: '800 g boule', unitDoughGrams: 800, bakeLossPercent: 14 },
  { id: 'batard-500', label: '500 g bâtard', unitDoughGrams: 500, bakeLossPercent: 14 },
  { id: 'baguette-350', label: '350 g baguette', unitDoughGrams: 350, bakeLossPercent: 18 },
  { id: 'ciabatta-250', label: '250 g ciabatta', unitDoughGrams: 250, bakeLossPercent: 15 },
  {
    id: 'focaccia-tray-1000',
    label: '1 kg focaccia tray',
    unitDoughGrams: 1000,
    bakeLossPercent: 12,
  },
  { id: 'pizza-base-250', label: '250 g pizza base', unitDoughGrams: 250, bakeLossPercent: 15 },
  { id: 'roll-120', label: '120 g roll', unitDoughGrams: 120, bakeLossPercent: 10 },
  { id: 'bun-80', label: '80 g bun', unitDoughGrams: 80, bakeLossPercent: 10 },
  { id: 'bagel-100', label: '100 g bagel', unitDoughGrams: 100, bakeLossPercent: 8 },
];

// What a hand-entered shape's bake loss starts at: the tinned-loaf figure, the
// most ordinary thing a dough becomes. Deliberately a DEFAULT and not a required
// answer — the original refusal to allow a custom shape was that nobody can be
// asked for a number they have no way to know, and that objection is met by
// offering a fair one and showing what it implies (the baked weight, on screen,
// next to the dough weight) rather than by refusing the shape.
export const DEFAULT_BAKE_LOSS_PERCENT = 12;

export function unitShapePreset(id: string): UnitShapePreset | null {
  return UNIT_SHAPE_PRESETS.find((preset) => preset.id === id) ?? null;
}

// A preset is a shape without a count — "a 120 g roll" is a thing; "12 of them"
// is what you are making today.
export function unitShapeFromPreset(preset: UnitShapePreset, count: number): UnitShape {
  return {
    label: preset.label,
    count,
    unitDoughGrams: preset.unitDoughGrams,
    bakeLossPercent: preset.bakeLossPercent,
  };
}

// What one unit weighs out of the oven, EXACT and unrounded — the caller rounds
// for display. One expression with two callers, `solveFormula`'s `SolvedUnits` and
// the formula screen's declaration, which have to agree: the screen is where a
// bake-loss figure is now typed, so the number it shows back is the only check
// anybody gets on the number they entered.
export function bakedUnitGrams(
  shape: Pick<UnitShape, 'unitDoughGrams' | 'bakeLossPercent'>,
): number {
  return shape.unitDoughGrams * (1 - shape.bakeLossPercent / 100);
}

export function targetYield(shape: UnitShape): ReferenceYield {
  return { kind: 'target', shape };
}

export function basisYield(grams: number): ReferenceYield {
  return { kind: 'basis', grams };
}
