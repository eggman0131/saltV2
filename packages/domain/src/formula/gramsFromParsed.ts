import type { ParsedIngredientDoc } from '../schemas/recipe.js';
import type { DensityClass } from '../schemas/formula.js';
import { DEFAULT_DENSITY_CLASS, gramsFromMillilitres } from './density.js';
import { quantityToNumber } from '../recipe/index.js';

// A parsed recipe ingredient reduced to the one number a formula can scale.
// Returns null — never a guess — when there is no gram figure to be had, and a
// null means "not a formula component" rather than "component of zero".
//
// A range is collapsed by `quantityToNumber`, which owns that decision for every
// consumer (issue #917); the rule and the argument for it live there and are not
// restated here. What this module owes on top of it is a DISCLOSURE: the moment a
// range becomes a percentage the range is gone for good — the formula stores a
// point value, and a scaled batch will later print `58 g olive oil` while the
// recipe page still reads "2–3 tbsp". The mapping screen is the only moment
// anyone can object, because it is the moment the information is lost.

export function gramsFromParsed(
  parsed: ParsedIngredientDoc | null,
  density: DensityClass = DEFAULT_DENSITY_CLASS,
): number | null {
  if (parsed === null || parsed.quantity === null) return null;

  const amount = quantityToNumber(parsed.quantity);

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
