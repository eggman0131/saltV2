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
export {
  subscribeProductForms,
  upsertProductForm,
  deleteProductForm,
} from './productFormSubscription.js';
export { subscribeAisles, saveAisles } from './aisleSubscription.js';
// Purchase counts (issue #726): the tick-off history behind the add field's
// ordering. One write per GESTURE carrying `increment` transforms — see
// canonPurchaseSync.ts for why the sentinel cannot leave this package.
export { recordCanonPurchases, loadCanonPurchaseCounts } from './canonPurchaseSync.js';
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
export {
  subscribeCookSession,
  subscribeMyCookSessions,
  loadCookSession,
  saveCookSession,
  deleteCookSession,
} from './cookSessionSubscription.js';
// Guided plan (issue #751): the per-recipe prep list + step notes. A single
// family-shared doc keyed by the recipe id, plus the callable that authors one.
// See guidedPlanSubscription.ts for why a corrupt plan is an error rather than
// "no plan yet" — unlike a cook session, a human wrote it.
export {
  subscribeGuidedPlan,
  loadGuidedPlan,
  saveGuidedPlan,
  deleteGuidedPlan,
} from './guidedPlanSubscription.js';
export { callGenerateGuidedPlan } from './guidedPlanCallables.js';
// Formula (issue #806, epic #778): the per-recipe composition as baker's
// percentages against a declared basis. Same shape as the guided plan above — one
// family-shared doc keyed by the recipe id — and same read contract: a corrupt
// formula is an error, never "no formula yet". No delete: nothing removes one.
export { subscribeFormula, loadFormula, saveFormula } from './formulaSubscription.js';
export { callExtractProcessStages } from './formulaCallables.js';
// Batches (issue #812, epic #778): one document per RUN of a formula, with the
// quantities and the schedule frozen at start. A random id and many per recipe, so
// unlike the two above this is a collection subscription as well as a doc one — see
// batchSync.ts for why the list read skips a corrupt document while the single-doc
// read refuses it.
export { subscribeBatches, subscribeBatch, saveBatch } from './batchSync.js';
export { savePushSubscription, deletePushSubscription } from './pushSubscriptionSync.js';
export { streamChefChat, callGenerateChatTitle } from './chatCallables.js';
export { callAuthorRecipe } from './authorRecipeCallable.js';
export {
  callParseRecipeIngredients,
  callDescribeRecipeScene,
  callExtractRecipeFromUrl,
  callExtractRecipeFromPhoto,
  callRegenerateRecipeImage,
  callSetRecipeImageUpload,
} from './recipeCallables.js';
export {
  subscribeMealPlanConfig,
  subscribeMealPlanTemplate,
  subscribeMealPlanWeek,
  loadMealPlanWeek,
  saveMealPlanConfig,
  saveMealPlanTemplate,
  saveMealPlanWeek,
} from './mealPlanSync.js';
// Shop day (issue #629): the planner week's range read over doc ids, plus the
// mark/clear writes. See shoppingDaySync.ts for why the id is the date.
export {
  subscribeShoppingDaysInRange,
  saveShoppingDay,
  deleteShoppingDay,
} from './shoppingDaySync.js';
export { subscribeDevSettings, saveDevSettings } from './devSettingsSync.js';
export { subscribeAppSettings, saveAppSettings } from './appSettingsSync.js';
export { callListAiModels, callTestModel } from './aiModelCallables.js';
// Pushover device readout for the /settings cook-notifications card (issue #680).
export { callListPushoverDevices } from './pushoverCallables.js';
export type { PushoverDevices } from './pushoverCallables.js';
// Weather forecast cache (issue #382, Phase 2): client-side subscribe + the
// refresh callable wrapper. Phase 3 (planner render) consumes the subscribe.
export { subscribeWeatherForecast } from './weatherSync.js';
export { callRefreshWeatherForecast } from './weatherCallables.js';
export type { RefreshWeatherForecastResult } from './weatherCallables.js';
// E2E-only AI stub writer (test-infra Phase 1). Used by apps/web-pwa's e2e
// bridge to register canned answers for the CF fake model; never used in prod.
export { setAiStub } from './e2eAiStubSync.js';
// E2E-only Firestore local-cache probe (issue #734). Answers "did the SDK's own
// cache still hold the document the store was missing?" from a failing e2e run.
// Reachable only through the emulator-gated e2e bridge; never used in prod.
export { probeFirestoreCache } from './e2eFirestoreProbe.js';
export type { E2EFirestoreCacheProbe } from './e2eFirestoreProbe.js';
export type { AiCatalogModel, AiModelCatalog, TestModelOutcome } from './aiModelCallables.js';
export type {
  IdentifyEquipmentCandidate,
  IdentifyEquipmentResult,
  PopulateAccessory,
  PopulateEquipmentEntryResult,
} from './equipmentCallables.js';
