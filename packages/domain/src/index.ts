// Canon module — re-export the canon module's published surface so that
// adapters and apps can reach it via @salt/domain. Cross-module access
// inside the domain itself goes through './canon' (the module index).
export type {
  CanonItem,
  Aisle,
  AislesDocument,
  CanonLocalStorePort,
  CursorScope,
  CanonSyncTransportPort,
  SyncBatch,
  SyncPending,
  ManifestTick,
  AisleSyncTransportPort,
  AisleSyncBatch,
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
  createCanonItem,
  mergeCanonItems,
  resolveCanonConflict,
  createCanonLookup,
  MatchLogBuilder,
  MATCH_THRESHOLDS,
  embedMatch,
  matchOrCreate,
  createAisle,
  createAislesBulk,
  renameAisle,
  reorderAisles,
  deleteAisles,
  mergeAisles,
  listAisles,
  getAisleUsage,
} from './canon/index.js';
export type {
  ConflictStrategy,
  MatchOrCreateInput,
  MatchOrCreatePorts,
  MatchOrCreateResult,
} from './canon/index.js';
export { renameCanonItem, setCanonItemAisle, setCanonItemSynonyms } from './canon/index.js';

// Auth module — published surface.
export type { User, AuthProvider } from './auth/index.js';

// Cross-cutting ports.
export type { ErrorReportingPort } from './ErrorReportingPort.js';
