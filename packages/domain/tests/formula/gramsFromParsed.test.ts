import { describe, it, expect } from 'vitest';
import { gramsFromParsed } from '../../src/index.js';
import { DENSITY_G_PER_ML } from '../../src/formula/index.js';
import type { ParsedIngredientDoc } from '../../src/schemas/recipe.js';
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

// The reduction itself now lives in the recipe module and is pinned by
// tests/recipe/quantityToNumber.test.ts — the formula used to keep a second copy
// of it (`amountFromQuantity`, which took the midpoint) and that is the fork
// issue #917 closed. What is left here is what a FORMULA does with the number.

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

  it('collapses a range before converting', () => {
    // "2–3 tbsp extra virgin olive oil" → 45 ml (the top — see quantityToNumber)
    // → 41.4 g. Was 37.5 ml → 34.5 g while the formula kept its own midpoint
    // reduction; the shopping list read the same line as 30 ml.
    const range = parsed({ quantity: { type: 'range', min: 30, max: 45 }, unit: 'ml' });
    expect(gramsFromParsed(range, 'oil')).toBeCloseTo(41.4, 9);
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
    // A zero denominator cannot come off a parsed document (`MixedQuantitySchema`
    // pins it positive) and `quantityToNumber` does not special-case it — the
    // divide gives Infinity and the finite check below is what catches it. Same
    // null, one guard instead of two.
    expect(
      gramsFromParsed(
        parsed({ quantity: { type: 'mixed', whole: 1, numerator: 1, denominator: 0 }, unit: 'g' }),
      ),
    ).toBeNull();
  });
});
