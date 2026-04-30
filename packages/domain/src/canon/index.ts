// Canon module — published surface.
// This file is the ONLY thing other domain modules and coordinators are allowed
// to import from canon. Anything not re-exported here is private to canon by
// design.

export type { CanonItem } from './entities/CanonItem.js';
export type { Aisle } from './entities/Aisle.js';
export type { CanonLocalStorePort } from './ports/CanonLocalStorePort.js';
export type {
  CanonSyncTransportPort,
  SyncBatch,
  SyncPending,
} from './ports/CanonSyncTransportPort.js';
export type { AisleStorePort } from './ports/AisleStorePort.js';
export type { CanonLookupPort } from './ports/CanonLookupPort.js';
export type { IdGenerator } from './ports/IdGenerator.js';
export { createCanonItem } from './commands/createCanonItem.js';
export type { CreateCanonItemInput } from './commands/createCanonItem.js';
export { mergeCanonItems } from './commands/mergeCanonItems.js';
export { resolveCanonConflict } from './commands/resolveCanonConflict.js';
export type { ConflictStrategy } from './commands/resolveCanonConflict.js';
export { createCanonLookup } from './queries/createCanonLookup.js';
export type { MatchCandidate, MatchStage } from './entities/MatchCandidate.js';
export { MATCH_THRESHOLDS } from './queries/matchThresholds.js';
export type {
  MatchLogEntry,
  StageLog,
  CandidateLog,
  FinalDecision,
} from './entities/MatchLogEntry.js';
export type { MatchLoggingPort } from './ports/MatchLoggingPort.js';
export type { EmbeddingPort } from './ports/EmbeddingPort.js';
export { MatchLogBuilder } from './commands/buildMatchLog.js';
export { embedMatch } from './queries/embedMatch.js';
export type {
  CanonArbitrationPort,
  ArbitrationRequest,
  ArbitrationResult,
} from './ports/CanonArbitrationPort.js';
export { matchOrCreate } from './commands/matchOrCreate.js';
export type { MatchOrCreateInput, MatchOrCreatePorts } from './commands/matchOrCreate.js';
