// Canon module — re-export the canon module's published surface so that
// adapters and apps can reach it via @salt/domain. Cross-module access
// inside the domain itself goes through './canon' (the module index).
export type {
  CanonItem,
  CanonStorePort,
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
} from './canon/index.js';
export {
  createCanonItem,
  createCanonLookup,
  MatchLogBuilder,
  MATCH_THRESHOLDS,
} from './canon/index.js';

// Auth module — published surface.
export type { User, AuthProvider } from './auth/index.js';
