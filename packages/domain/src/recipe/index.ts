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
// The ONE numeric reduction of a `Quantity` (issue #917) — shared by the shopping
// list and the formula mapping screen so a range cannot mean two amounts. The
// choice of which end a range collapses to is argued in the file, once.
export { quantityToNumber } from './queries/quantity.js';
// Silent match problems — a line that reads as matched and buys the wrong thing
// (or nothing). Shared by the recipe list's pip and the ingredient match sheet so
// the two can never disagree about what counts as wrong.
export { ingredientMatchIssue, recipeMatchIssueCount } from './queries/matchIssues.js';
export type { IngredientMatchIssue } from './queries/matchIssues.js';
export {
  takesIngredients,
  isCookable,
  isPlannable,
  isAuthorable,
  takesComponents,
} from './queries/capabilities.js';
// The shape of a cook — elapsed vs hands-on, and where the waiting goes (issue
// #878). Read by the recipe page's ribbon; returns `null` when the steps carry
// no timers, which is the "no ribbon at all" case.
export { cookShape, UNNAMED_WAIT_LABEL, OTHER_WAITS_LABEL } from './queries/cookShape.js';
export type { CookShape, CookShapeSegment, CookShapeSegmentKind } from './queries/cookShape.js';
// Meals — a recipe built from several other recipes (issue #752). One level deep,
// nothing aggregated; see the module header.
export {
  hasComponents,
  resolveComponents,
  componentDisplayLines,
  canBeComponentOf,
  insertComponentByCookTime,
  expandForPlanner,
  mergePlannerRecipeIds,
} from './queries/components.js';
// Recipe-drift comparison, shared by everything that snapshots a recipe's
// `updatedAt`: the cook session (#556) and the guided plan (#751).
export { hasRecipeChanged } from './queries/hasRecipeChanged.js';
// Which step each piece of kit should be DRAWN at (issue #882) — the
// contiguous-run rule, shared by the method column, the cook deck and the guided
// step screen so the three cannot disagree about when the pan comes out.
export { kitByStep } from './queries/kitByStep.js';
export { findProducingRecipes } from './queries/producers.js';
export { diffRecipe } from './queries/diffRecipe.js';
// One level below diffRecipe: what moved INSIDE a changed field, so the review
// gate can show a reword as the words that differ (issue #825).
export { diffWords, unchangedRatio } from './queries/diffWords.js';
export type { DiffPart } from './queries/diffWords.js';
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
