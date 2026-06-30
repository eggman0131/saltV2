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
  CanonLookupPort,
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
  mergeCanonItems,
  resolveCanonConflict,
  createCanonLookup,
  MatchLogBuilder,
  MATCH_THRESHOLDS,
  embedMatch,
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
  listAisles,
  getAisleUsage,
  CANON_ICON_HIDDEN,
  isCanonIconRenderable,
  hasLiveCanonMatch,
} from './canon/index.js';
export type {
  ConflictStrategy,
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
  emptyDay,
  emptyWeek,
  emptyTemplate,
  instantiateWeek,
  setDayNote,
  setDayChefs,
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
  RecipeMetadata,
  RecipeSource,
} from './recipe/index.js';
export {
  emptyRecipe,
  emptyIngredientGroup,
  newIngredient,
  newStep,
  clearIngredientMatch,
  flattenIngredients,
} from './recipe/index.js';
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

// Weather module — pure forecast aggregation + staleness logic (issue #382).
export { aggregateForecastWindow, isForecastStale, FORECAST_MAX_AGE_MS } from './weather/index.js';

// Cross-cutting ports.
export type { ErrorReportingPort } from './ErrorReportingPort.js';
