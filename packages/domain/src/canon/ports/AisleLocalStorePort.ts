import type { ReadResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';

export interface AisleLocalStorePort {
  /** Persists the full aisles list at the given revision. */
  save(aisles: readonly Aisle[], revision: number): Promise<ReadResult<void, DomainError>>;
  /** Returns the stored aisles and their current revision, or null if never written. */
  load(): Promise<
    ReadResult<{ readonly aisles: readonly Aisle[]; readonly revision: number } | null, DomainError>
  >;
  /**
   * Overwrites any pending save with the new aisles list.
   * Depth-1 queue: last local write wins before sync drains it.
   */
  enqueuePendingSave(aisles: readonly Aisle[]): Promise<ReadResult<void, DomainError>>;
  /** Returns and clears the pending aisles list, or null if nothing is queued. */
  drainPendingSave(): Promise<ReadResult<readonly Aisle[] | null, DomainError>>;
}
