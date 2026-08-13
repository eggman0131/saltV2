import { describe, it, expect } from 'vitest';
import { amountFromQuantity, gramsFromParsed, DENSITY_G_PER_ML } from '../../src/index.js';
import type { ParsedIngredientDoc } from '../../src/schemas/index.js';

// Reducing a parsed recipe ingredient to the one number a formula can scale.
// Lines below are what `parseRecipeIngredients` actually emits for real recipes.

function parsed(overrides: Partial<ParsedIngredientDoc>): ParsedIngredientDoc {
  return {
    quantity: null,
    unit: null,
    item: 'something',
    preparation: [],
    notes: null,
    displayText: null,
    ...overrides,
  };
}

describe('amountFromQuantity', () => {
  it('reads a plain amount', () => {
    expect(amountFromQuantity({ type: 'single', value: 350 })).toBe(350);
  });

  it('takes the midpoint of a range', () => {
    // "2–3 tbsp olive oil" → 30–45 ml → 37.5 ml. The mapping screen owes the cook
    // this disclosure: once it is a percentage, the range is gone for good.
    expect(amountFromQuantity({ type: 'range', min: 30, max: 45 })).toBe(37.5);
  });

  it('reads an exact fraction', () => {
    // "1 ½ tsp" — stored as a fraction so the original round-trips.
    expect(amountFromQuantity({ type: 'mixed', whole: 1, numerator: 1, denominator: 2 })).toBe(1.5);
    expect(amountFromQuantity({ type: 'mixed', whole: 0, numerator: 3, denominator: 4 })).toBe(
      0.75,
    );
  });

  it('has nothing to say about no amount', () => {
    expect(amountFromQuantity(null)).toBeNull();
  });
});

describe('gramsFromParsed', () => {
  it('takes grams as grams', () => {
    expect(gramsFromParsed(parsed({ quantity: { type: 'single', value: 500 }, unit: 'g' }))).toBe(
      500,
    );
  });

  it('reads water-like ml one for one', () => {
    expect(gramsFromParsed(parsed({ quantity: { type: 'single', value: 350 }, unit: 'ml' }))).toBe(
      350,
    );
  });

  it('reads oil and syrup through their density class', () => {
    const hundredMl = parsed({ quantity: { type: 'single', value: 100 }, unit: 'ml' });
    expect(gramsFromParsed(hundredMl, 'oil')).toBeCloseTo(92, 9);
    // The class that actually breaks a flat 1:1 — a honey wholemeal loaf is a
    // real thing, and 100 ml of honey is 142 g, not 100 g.
    expect(gramsFromParsed(hundredMl, 'syrup')).toBeCloseTo(142, 9);
    expect(DENSITY_G_PER_ML.waterLike).toBe(1);
  });

  it('collapses a range to its midpoint before converting', () => {
    // "2–3 tbsp extra virgin olive oil" → 37.5 ml → 34.5 g.
    const range = parsed({ quantity: { type: 'range', min: 30, max: 45 }, unit: 'ml' });
    expect(gramsFromParsed(range, 'oil')).toBeCloseTo(34.5, 9);
  });

  it('is not a component when there is no amount', () => {
    // "salt, to taste", "a pinch of chilli flakes", "olive oil, for greasing" —
    // these already arrive with a null quantity, and scaling a bowl-greasing
    // 5 ml by 1.68 to get 8.4 ml is exactly what nobody wants.
    expect(gramsFromParsed(parsed({ quantity: null, unit: 'ml' }))).toBeNull();
    expect(gramsFromParsed(null)).toBeNull();
  });

  it('is not a component when the ingredient is counted rather than weighed', () => {
    // "2 eggs", "3 cloves of garlic". Domain cannot know what an egg weighs, and
    // a constant here would be a second scaling mechanism in disguise.
    expect(
      gramsFromParsed(parsed({ quantity: { type: 'single', value: 2 }, unit: null })),
    ).toBeNull();
  });

  it('is not a component at zero or a nonsense amount', () => {
    expect(
      gramsFromParsed(parsed({ quantity: { type: 'single', value: 0 }, unit: 'g' })),
    ).toBeNull();
    expect(
      gramsFromParsed(parsed({ quantity: { type: 'single', value: -5 }, unit: 'g' })),
    ).toBeNull();
    expect(
      gramsFromParsed(
        parsed({ quantity: { type: 'mixed', whole: 1, numerator: 1, denominator: 0 }, unit: 'g' }),
      ),
    ).toBeNull();
  });
});
