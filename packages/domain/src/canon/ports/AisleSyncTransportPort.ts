import type { ReadResult, WriteResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { AislesDocument } from '../entities/AislesDocument.js';
import type { ManifestTick } from './CanonSyncTransportPort.js';

/** Returned by a successful aisles pull when new data is available. */
export interface AisleSyncBatch {
  readonly aisles: readonly Aisle[];
  readonly cursor: number;
}

export interface AisleSyncTransportPort {
  /**
   * Fetches the aisles document from Firestore.
   * Returns null when the remote revision is not greater than sinceCursor.
   */
  pull(sinceCursor: number | null): Promise<ReadResult<AisleSyncBatch | null, DomainError>>;
  /**
   * Transactionally writes the full aisles list.
   * Returns Conflict<AislesDocument> when remote.revision !== baseRevision.
   * The adapter never auto-resolves — callers route the conflict to canonConflicts.
   */
  push(
    aisles: readonly Aisle[],
    baseRevision: number,
  ): Promise<WriteResult<AislesDocument, DomainError>>;
  /**
   * Registers a handler for canonManifest/global ticks.
   * Both CanonSyncTransportPort and AisleSyncTransportPort share the same underlying
   * manifest listener; the composition layer fans out ticks to each scope.
   */
  subscribe(onTick: (tick: ManifestTick) => void, onError: (err: DomainError) => void): () => void;
}
