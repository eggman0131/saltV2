// Canon module — re-export the canon module's published surface so that
// adapters and apps can reach it via @salt/domain. Cross-module access
// inside the domain itself goes through './canon' (the module index).
export type {
  CanonItem,
  Aisle,
  CanonLocalStorePort,
  CanonSyncTransportPort,
  SyncBatch,
  SyncPending,
  AisleStorePort,
  CanonLookupPort,
  IdGenerator,
  CreateCanonItemInput,
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
  createCanonLookup,
  MatchLogBuilder,
  MATCH_THRESHOLDS,
  embedMatch,
  createCanonMatchingPipeline,
} from './canon/index.js';

// Auth module — published surface.
export type { User, AuthProvider } from './auth/index.js';

// Cross-cutting ports.
export type { ErrorReportingPort } from './ErrorReportingPort.js';
