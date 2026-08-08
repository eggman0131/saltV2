// Canon module — re-export the canon module's published surface so that
// adapters and apps can reach it via @salt/domain. Cross-module access
// inside the domain itself goes through './canon' (the module index).
export type { MatchLogSummary } from './canon/index.js';
export type {
  CanonItem,
  ShoppingBehavior,
  CanonItemUnit,
  Aisle,
  AislesDocument,
  CanonLocalStorePort,
  AisleLocalStorePort,
  IdGenerator,
  CreateCanonItemInput,
  CreateAisleInput,
  CreateAislesBulkInput,
  RenameAisleInput,
  ReorderAislesInput,
  DeleteAislesInput,
  MergeAislesInput,
  PerItemMergeChoice,
  ItemMergeChoice,
  MatchCandidate,
  MatchStage,
  MatchLogEntry,
  StageLog,
  CandidateLog,
  FinalDecision,
  MatchLoggingPort,
  EmbeddingPort,
  CanonArbitrationPort,
  ArbitrationRequest,
  ArbitrationResult,
} from './canon/index.js';
export {
  normaliseName,
  summarizeMatchLog,
  createCanonItem,
  MatchLogBuilder,
  MATCH_THRESHOLDS,
  findClosestMatch,
  matchOrCreate,
  matchOrCreateBatch,
  appendCanonSynonym,
  createAisle,
  createAislesBulk,
  renameAisle,
  reorderAisles,
  deleteAisles,
  mergeAisles,
  CANON_ICON_HIDDEN,
  isCanonIconRenderable,
  hasLiveCanonMatch,
  isResolvedMatchState,
} from './canon/index.js';
export type {
  FindClosestMatchResult,
  MatchOrCreateInput,
  MatchOrCreatePorts,
  MatchOrCreateResult,
} from './canon/index.js';
export {
  approveCanonItem,
  renameCanonItem,
  setCanonItemAisle,
  setCanonItemSynonyms,
  setCanonItemShoppingBehavior,
  setCanonItemThreshold,
  setCanonItemThumbnail,
} from './canon/index.js';
export type { ApproveCanonItemOverrides } from './canon/index.js';

// ProductForm module — published surface.
export type {
  ProductForm,
  ProductFormYield,
  ProductFormIdGenerator,
  CreateProductFormInput,
  UpdateProductFormInput,
  FormDemand,
  ParentCountInput,
} from './productForm/index.js';
export {
  createProductForm,
  updateProductForm,
  confirmProductForm,
  resolveProductForm,
  convertYield,
  formParentCount,
  maxCountWinners,
  aggregateParentCount,
  decideProductFormProposal,
} from './productForm/index.js';

// Auth module — published surface.
export type { User, AuthProvider } from './auth/index.js';

// Equipment module — published surface.
export type {
  Accessory,
  EquipmentItem,
  EquipmentManifest,
  EquipmentManifestPort,
  EquipmentIdGenerator,
  AddEquipmentInput,
  RemoveEquipmentInput,
  RenameEquipmentInput,
  AddAccessoryInput,
  RemoveAccessoryInput,
  SetAccessoryOwnedInput,
  AddRuleInput,
  RemoveRuleInput,
  EditRuleInput,
} from './equipment/index.js';
export {
  addEquipment,
  removeEquipment,
  renameEquipment,
  addAccessory,
  removeAccessory,
  setAccessoryOwned,
  addRule,
  removeRule,
  editRule,
} from './equipment/index.js';

// Shopping list module — published surface.
export type {
  ShoppingList,
  ShoppingListItem,
  MatchState,
  SourceRef,
  ShoppingListsConfig,
  ShoppingListPort,
  ShoppingListItemPort,
  ShoppingListsConfigPort,
  ShoppingListIdGenerator,
  CreateListInput,
  RenameListInput,
  DeleteListInput,
  SetDefaultListInput,
  AddItemInput,
  EditItemRawTextInput,
  EditItemNotesInput,
  CheckItemInput,
  ConfirmItemNeededInput,
  SetItemNeedsCheckInput,
  UncheckItemInput,
  DeleteItemInput,
  MoveItemsInput,
  MoveItemsResult,
  CanonInfo as ShoppingListCanonInfo,
  AisleInfo as ShoppingListAisleInfo,
  OtherContributor,
  OtherBucket,
  CheckedBucket,
  AmountSubtotal,
  AisleRow,
  AisleGroup,
  GroupedShoppingList,
  GroupItemsOptions,
  RecipeGroup,
  ManualBucket,
  GroupedByRecipe,
  RecipeItemAddDefault,
  ParsedEntry,
  EntryParsePort,
} from './shoppingList/index.js';
export {
  createList,
  renameList,
  deleteList,
  setDefaultList,
  addItem,
  editItemRawText,
  editItemNotes,
  editItemAmountUnit,
  checkItem,
  confirmItemNeeded,
  setItemNeedsCheck,
  uncheckItem,
  deleteItem,
  clearCheckedItems,
  moveItems,
  groupItemsByAisle,
  groupItemsByRecipe,
  resolveItemDisplayName,
  recipeItemAddDefault,
  parseShoppingListEntry,
} from './shoppingList/index.js';

// Members module — published surface (issue #155).
export type { Member, CreateMemberInput, UpdateMemberPatch } from './members/index.js';
export {
  normaliseMemberEmail,
  createMember,
  updateMember,
  memberInitials,
  memberFirstName,
  sortMembers,
} from './members/index.js';

// Meal planning module — published surface (issue #169).
export type {
  Weekday,
  Attendee,
  Day,
  MealPlanConfig,
  MealPlanTemplate,
  MealPlanWeek,
} from './mealPlan/index.js';
export {
  WEEKDAYS,
  WEEKDAY_INDEX,
  weekStartFor,
  weekDates,
  weekdayOf,
  dayIndexInWeek,
  weekExtendsIntoNext,
  WEEK_EXTENSION_DAYS,
  templateWeekStarts,
  TEMPLATE_WEEK_OFFERS,
  emptyDay,
  emptyWeek,
  emptyTemplate,
  instantiateWeek,
  setDayNote,
  setDayChefs,
  setDayRecipes,
  setDayGuests,
  addAttendee,
  removeAttendee,
  setAttendeeHomeTime,
  setAttendeeNote,
} from './mealPlan/index.js';

// Recipe module — published surface (issue #179).
export type {
  SingleQuantity,
  RangeQuantity,
  MixedQuantity,
  Quantity,
  ParsedIngredient,
  Ingredient,
  IngredientGroup,
  Step,
  StepTimer,
  Recipe,
  RecipeImage,
  RecipeKind,
  RecipeMetadata,
  RecipeSource,
} from './recipe/index.js';
export {
  emptyRecipe,
  duplicateRecipe,
  emptyIngredientGroup,
  newIngredient,
  newStep,
  clearIngredientMatch,
  flattenIngredients,
  takesIngredients,
  isCookable,
  isPlannable,
  findProducingRecipes,
  diffRecipe,
  hasRecipeChanged,
  pickPlaceholder,
  PLACEHOLDER_MOODS,
  PLACEHOLDER_CONDITION_TAGS,
} from './recipe/index.js';
export type { PlaceholderMood, PlaceholderCondition } from './recipe/index.js';
export type { ParsedImportUrl, IpClass } from './recipe/index.js';
export {
  parseImportUrl,
  isHttpsScheme,
  hostnameAsIpLiteral,
  classifyIp,
  isPublicIp,
  isIpv4,
  isIpv6,
} from './recipe/index.js';

// Weather module — pure forecast aggregation + staleness logic (Phase 2) and
// pure render-policy classifiers (Phase 3) (issue #382).
export { aggregateForecastWindow, isForecastStale, FORECAST_MAX_AGE_MS } from './weather/index.js';
export { temperatureBand, classifyEatingMood } from './weather/index.js';
export type { TemperatureBand, EatingMood } from './weather/index.js';
export { weatherSeverity, mostSignificantWeatherCode, weatherIcon } from './weather/index.js';
export type { WeatherIconId } from './weather/index.js';

// Cook-session module — pure cook-mode session state: mise ticking, step
// completion, timers, clock formatting (issue #556). Immutable producers, and
// every timestamp is injected (never read from a clock). The recipe-drift
// comparison it used to own now lives in the recipe module (`hasRecipeChanged`),
// which the guided plan (#751) shares.
export {
  makeFreshSession,
  withStepDone,
  withIngredientChecked,
  withPrepChecked,
  withAllIngredientsChecked,
  withGroupChecked,
  withTimerStarted,
  withTimerDismissed,
  firstUseByStep,
  firstIncompleteStepId,
  miseProgress,
  guidedMiseProgress,
  unpreppedIngredients,
  formatClock,
  timerProgress,
} from './cookSession/index.js';
export type { MakeFreshSessionArgs, MiseProgress } from './cookSession/index.js';

// Shopping-day module (issue #629) — pure helpers over `shoppingDays/{date}`:
// the planner's pre-shop shading predicate, the reminder's "tomorrow in zone"
// projection, and the one-shop-per-week reducer. No I/O, no clock.
export {
  isBeforeShop,
  dateInZone,
  addCalendarDays,
  daysBetween,
  tomorrowInZone,
  shopDayForWeek,
} from './shoppingDay/index.js';

// Personal-view module (issues #634, #682) — the projection behind "Mine": the
// standing queue of entries nobody has saved yet. Pure, no per-user storage and
// no clock.
export { needsReview } from './personalView/index.js';

// URL module — pure display-time cache-buster for regenerated image URLs (#460).
export { appendCacheBuster } from './url/index.js';

// Cross-cutting ports.
export type { ErrorReportingPort } from './ErrorReportingPort.js';
