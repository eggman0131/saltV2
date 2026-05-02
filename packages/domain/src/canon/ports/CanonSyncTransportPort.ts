import type { ReadResult, WriteResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

/** Emitted by the canonManifest/global onSnapshot listener on every document tick. */
export interface ManifestTick {
  readonly itemsRevision: number;
  readonly aislesRevision: number;
}

export interface SyncBatch {
  readonly upserted: readonly CanonItem[];
  readonly deleted: readonly string[];
  /** Highest revision seen in this batch — use as the new local cursor. */
  readonly cursor: number;
}

export interface SyncPending {
  readonly initialSync: boolean;
  readonly pull: boolean;
  readonly push: boolean;
}

export interface CanonSyncTransportPort {
  pull(sinceCursor: number | null): Promise<ReadResult<SyncBatch, DomainError>>;
  /**
   * Transactionally writes a single canon item.
   * Returns Conflict<CanonItem> when remote.revision !== item.revision.
   * The adapter never auto-resolves — callers route the conflict to canonConflicts.
   */
  push(item: CanonItem): Promise<WriteResult<CanonItem, DomainError>>;
  /**
   * Registers a handler for canonManifest/global ticks.
   * Shares the same underlying manifest listener as AisleSyncTransportPort.
   */
  subscribe(onTick: (tick: ManifestTick) => void, onError: (err: DomainError) => void): () => void;
  readonly pending: SyncPending;
}
