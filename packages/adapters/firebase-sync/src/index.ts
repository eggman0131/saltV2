export type { FirebaseOptions } from 'firebase/app';
export { initFirebase, setFirestoreNetwork } from './init.js';
export type { AppCheckConfig } from './init.js';
export { createFirebaseAuth } from './auth.js';
// Sign-out / token-refresh teardown-race reader. Service onError sites consult
// this before reporting an AuthError so the in-flight-listener permission-denied
// race is suppressed (a genuine rules-misconfig AuthError, with no transition in
// flight, still reports).
export { isAuthTransitioning } from './authTransition.js';
export { subscribeCanonItems, upsertCanonItem, deleteCanonItem } from './canonSubscription.js';
export { subscribeAisles, saveAisles } from './aisleSubscription.js';
export {
  subscribeEquipmentManifest,
  saveEquipmentManifest,
} from './equipmentManifestSubscription.js';
export {
  callMatchOrCreate,
  callCanonicaliseRecipeIngredients,
  callRegenerateCanonIcon,
} from './canonMatching.js';
export { callIdentifyEquipment, callPopulateEquipmentEntry } from './equipmentCallables.js';
export {
  subscribeShoppingLists,
  listShoppingLists,
  createShoppingList,
  renameShoppingList,
  deleteShoppingList,
} from './shoppingListSubscription.js';
export {
  subscribeShoppingListItems,
  listShoppingListItems,
  saveShoppingListItem,
  deleteShoppingListItem,
  deleteShoppingListItems,
  moveShoppingListItems,
} from './shoppingListItemSubscription.js';
export {
  subscribeShoppingListsConfig,
  loadShoppingListsConfig,
  saveShoppingListsConfig,
} from './shoppingListsConfigSubscription.js';
export { subscribeMembers, upsertMember, deleteMember } from './membersSubscription.js';
export { subscribeRecipes, loadRecipe, saveRecipe, deleteRecipe } from './recipeSubscription.js';
export {
  subscribeChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
} from './chatSessionSubscription.js';
export { streamChefChat, callGenerateChatTitle } from './chatCallables.js';
export { callAuthorRecipe } from './authorRecipeCallable.js';
export { callParseRecipeIngredients, callExtractRecipeFromUrl } from './recipeCallables.js';
export {
  subscribeMealPlanConfig,
  subscribeMealPlanTemplate,
  subscribeMealPlanWeek,
  saveMealPlanConfig,
  saveMealPlanTemplate,
  saveMealPlanWeek,
} from './mealPlanSync.js';
export { subscribeDevSettings, saveDevSettings } from './devSettingsSync.js';
export { subscribeAppSettings, saveAppSettings } from './appSettingsSync.js';
export { callListAiModels, callTestModel } from './aiModelCallables.js';
// Weather forecast cache (issue #382, Phase 2): client-side subscribe + the
// refresh callable wrapper. Phase 3 (planner render) consumes the subscribe.
export { subscribeWeatherForecast } from './weatherSync.js';
export { callRefreshWeatherForecast } from './weatherCallables.js';
export type { RefreshWeatherForecastResult } from './weatherCallables.js';
// E2E-only AI stub writer (test-infra Phase 1). Used by apps/web-pwa's e2e
// bridge to register canned answers for the CF fake model; never used in prod.
export { setAiStub } from './e2eAiStubSync.js';
export type { AiCatalogModel, AiModelCatalog, TestModelOutcome } from './aiModelCallables.js';
export type {
  IdentifyEquipmentCandidate,
  IdentifyEquipmentResult,
  PopulateAccessory,
  PopulateEquipmentEntryResult,
} from './equipmentCallables.js';
