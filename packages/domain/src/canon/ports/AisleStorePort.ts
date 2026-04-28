import type { ReadResult, WriteResult, DomainError } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';

// Infrastructure port: implemented by adapters (local-store / firebase-sync).
// The aisle list is a single KV document — adapters save and load the full
// list as one unit. `save` is WriteResult so a revision-mismatch Conflict
// can surface at sync time; `load` is ReadResult and returns null when the
// document has never been written.
export interface AisleStorePort {
  save(aisles: readonly Aisle[]): Promise<WriteResult<readonly Aisle[], DomainError>>;
  load(): Promise<ReadResult<readonly Aisle[] | null, DomainError>>;
}
