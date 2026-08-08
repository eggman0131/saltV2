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
export type {
  Recipe,
  RecipeImage,
  RecipeKind,
  RecipeMetadata,
  RecipeSource,
} from './entities/Recipe.js';

export {
  emptyRecipe,
  duplicateRecipe,
  emptyIngredientGroup,
  newIngredient,
  newStep,
} from './commands/builders.js';
export { clearIngredientMatch } from './commands/clearIngredientMatch.js';
export { flattenIngredients } from './queries/ingredients.js';
export { takesIngredients, isCookable, isPlannable } from './queries/capabilities.js';
// Recipe-drift comparison, shared by everything that snapshots a recipe's
// `updatedAt`: the cook session (#556) and the guided plan (#751).
export { hasRecipeChanged } from './queries/hasRecipeChanged.js';
export { findProducingRecipes } from './queries/producers.js';
export { diffRecipe } from './queries/diffRecipe.js';
export {
  pickPlaceholder,
  PLACEHOLDER_MOODS,
  PLACEHOLDER_CONDITION_TAGS,
} from './queries/pickPlaceholder.js';
export type { PlaceholderMood, PlaceholderCondition } from './queries/pickPlaceholder.js';

// URL import — pure SSRF/URL classification helpers (no I/O). The live fetch +
// DNS resolution lives in cloud-functions; this module only holds the policy.
export type { ParsedImportUrl, IpClass } from './urlImport/index.js';
export {
  parseImportUrl,
  isHttpsScheme,
  hostnameAsIpLiteral,
  classifyIp,
  isPublicIp,
  isIpv4,
  isIpv6,
} from './urlImport/index.js';
