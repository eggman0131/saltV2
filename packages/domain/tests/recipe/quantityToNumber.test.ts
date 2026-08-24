import { describe, it, expect } from 'vitest';
import { quantityToNumber, gramsFromParsed } from '../../src/index.js';

// The ONE numeric reduction of a `Quantity` (issue #917). Before it there were
// two: the shopping list took a range's `min` and the formula mapping screen took
// its midpoint, so a single "2–3 tbsp olive oil" line was bought at 30 ml and
// baked at 37.5 ml.
//
// Which end a range collapses to is a PRODUCT decision, not an implementation
// detail, so it is pinned here with the reason attached — changing the answer
// should mean arguing with this test rather than editing a number.

describe('quantityToNumber', () => {
  it('reads a plain amount as itself', () => {
    expect(quantityToNumber({ type: 'single', value: 350 })).toBe(350);
  });

  it('reads an exact fraction', () => {
    // "1 ½ tsp" — stored as a fraction so the original round-trips.
    expect(quantityToNumber({ type: 'mixed', whole: 1, numerator: 1, denominator: 2 })).toBe(1.5);
    expect(quantityToNumber({ type: 'mixed', whole: 0, numerator: 3, denominator: 4 })).toBe(0.75);
  });

  it('collapses a range to the TOP, so the shop is never short', () => {
    // "2–3 tbsp olive oil" → 30–45 ml → 45 ml.
    //
    // The shopping list is what settles this. Too little of an ingredient is a
    // dinner that cannot be cooked; too much is a bit left in the cupboard. The
    // bottom of the range is the one figure guaranteed to be short whenever the
    // cook reads the recipe generously.
    //
    // Not the midpoint (37.5): nobody wrote 37.5. The top is a number the recipe
    // actually states, which is the same reason `resolveSchedule` plans a
    // "45–60 minute" prove at 60.
    expect(quantityToNumber({ type: 'range', min: 30, max: 45 })).toBe(45);
    expect(quantityToNumber({ type: 'range', min: 30, max: 45 })).not.toBe(30);
    expect(quantityToNumber({ type: 'range', min: 30, max: 45 })).not.toBe(37.5);
  });

  it('is a point, so a degenerate range is just that point', () => {
    expect(quantityToNumber({ type: 'range', min: 200, max: 200 })).toBe(200);
  });

  it('is the same reduction the formula runs on', () => {
    // The fork this closes: the two consumers now agree, digit for digit, about
    // what "2–3 tbsp" of a water-like ingredient weighs.
    const range = { type: 'range', min: 30, max: 45 } as const;
    expect(
      gramsFromParsed({
        quantity: range,
        unit: 'ml',
        item: 'olive oil',
        preparation: [],
        notes: null,
        displayText: '2–3 tbsp',
      }),
    ).toBe(quantityToNumber(range));
  });
});
