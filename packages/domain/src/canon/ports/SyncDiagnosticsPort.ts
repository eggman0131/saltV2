import type { CursorScope } from './CanonLocalStorePort.js';

/** Normalized diagnostic event emitted on every applied sync tick. */
export interface SyncTickEvent {
  readonly scope: CursorScope;
  readonly cursor: number;
  readonly batchSize: number;
  readonly durationMs: number;
}

export interface SyncDiagnosticsPort {
  syncTick(event: SyncTickEvent): void;
}
