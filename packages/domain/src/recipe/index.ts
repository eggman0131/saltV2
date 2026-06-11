// Recipe module — published surface (issue #179).
// This file is the ONLY thing other domain modules and adapters import from
// recipe. Anything not re-exported here is private. See docs/recipe-module.md.

export type {
  SingleQuantity,
  RangeQuantity,
  MixedQuantity,
  Quantity,
} from './entities/Quantity.js';
export type {
  MatchState,
  ParsedIngredient,
  Ingredient,
  IngredientGroup,
} from './entities/Ingredient.js';
export type { Step, StepTimer } from './entities/Step.js';
export type { Recipe, RecipeMetadata, RecipeSource } from './entities/Recipe.js';

export { emptyRecipe, emptyIngredientGroup, newIngredient, newStep } from './commands/builders.js';
export { flattenIngredients } from './queries/ingredients.js';
