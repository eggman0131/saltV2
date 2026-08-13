import type { ParsedIngredientDoc, QuantityDoc } from '../schemas/recipe.js';
import type { DensityClass } from '../schemas/formula.js';
import { DEFAULT_DENSITY_CLASS, gramsFromMillilitres } from './density.js';

// A parsed recipe ingredient reduced to the one number a formula can scale.
// Returns null — never a guess — when there is no gram figure to be had, and a
// null means "not a formula component" rather than "component of zero".

// A range collapses to its MIDPOINT, and the caller owes the cook a disclosure:
// "2–3 tbsp → 37.5 ml, taken as the midpoint". The moment a range becomes a
// percentage the range is gone for good — the formula stores a point value, and a
// scaled batch will later print `58 g olive oil` with a confidence the original
// never had while the recipe page still reads "2–3 tbsp". The mapping screen is
// the only moment anyone can object, because it is the moment the information is
// lost.
export function amountFromQuantity(quantity: QuantityDoc | null): number | null {
  if (quantity === null) return null;
  switch (quantity.type) {
    case 'single':
      return quantity.value;
    case 'range':
      return (quantity.min + quantity.max) / 2;
    case 'mixed':
      return quantity.denominator === 0
        ? null
        : quantity.whole + quantity.numerator / quantity.denominator;
  }
}

export function gramsFromParsed(
  parsed: ParsedIngredientDoc | null,
  density: DensityClass = DEFAULT_DENSITY_CLASS,
): number | null {
  if (parsed === null) return null;

  const amount = amountFromQuantity(parsed.quantity);
  if (amount === null) return null;

  // No unit means count-based — "2 eggs", "3 cloves". Domain cannot know what an
  // egg weighs, and guessing one here would be a second scaling mechanism
  // smuggled in behind a constant. The mapping screen supplies grams directly for
  // the handful of ingredients in this shape, or leaves them out of the formula.
  if (parsed.unit === null) return null;

  const grams = parsed.unit === 'ml' ? gramsFromMillilitres(amount, density) : amount;

  // "A pinch", "to taste", "for greasing" already arrive as a null quantity and
  // fall out above; a zero or nonsense figure gets the same treatment rather than
  // becoming a 0% component that scales to nothing.
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}
