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
  UncheckItemInput,
  DeleteItemInput,
  MoveItemsInput,
  MoveItemsResult,
  CanonInfo as ShoppingListCanonInfo,
  AisleInfo as ShoppingListAisleInfo,
  OtherContributor,
  OtherBucket,
  CheckedBucket,
  AisleGroup,
  GroupedShoppingList,
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
  uncheckItem,
  deleteItem,
  clearCheckedItems,
  moveItems,
  groupItemsByAisle,
  parseShoppingListEntry,
} from './shoppingList/index.js';

// Members module — published surface (issue #155).
export type { Member, CreateMemberInput, UpdateMemberPatch } from './members/index.js';
export {
  normaliseMemberEmail,
  createMember,
  updateMember,
  memberInitials,
  sortMembers,
} from './members/index.js';

// Cross-cutting ports.
export type { ErrorReportingPort } from './ErrorReportingPort.js';
