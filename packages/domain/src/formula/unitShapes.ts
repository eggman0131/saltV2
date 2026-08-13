import type { ReferenceYield, UnitShape } from '../schemas/formula.js';

// The shapes a dough gets divided into (issue #782). Pure data: the primitive is
// `count × unitDoughGrams` and is fully general, so this list can grow — or be
// ignored entirely in favour of a hand-entered shape — without the solve changing.
//
// The bake-loss figures are the phase's one open number: they want a baker's eye
// on them rather than a guess, and #782 says as much. `roll` is fixed by #778's
// worked example (120 g dough → about 108 g baked); the other two are ordinary
// domestic figures and are expected to be tuned once real bakes are logged.

export type UnitShapePreset = {
  id: string;
  label: string;
  // DOUGH weight per unit — never baked weight.
  unitDoughGrams: number;
  bakeLossPercent: number;
};

export const UNIT_SHAPE_PRESETS: readonly UnitShapePreset[] = [
  { id: 'tin-loaf-900', label: '900 g tin loaf', unitDoughGrams: 900, bakeLossPercent: 12 },
  { id: 'roll-120', label: '120 g roll', unitDoughGrams: 120, bakeLossPercent: 10 },
  { id: 'pizza-base-250', label: '250 g pizza base', unitDoughGrams: 250, bakeLossPercent: 15 },
];

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

export function targetYield(shape: UnitShape): ReferenceYield {
  return { kind: 'target', shape };
}

export function basisYield(grams: number): ReferenceYield {
  return { kind: 'basis', grams };
}
