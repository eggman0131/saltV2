import type { ReadResult, WriteResult, DomainError } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

// Infrastructure port: implemented by adapters (local-store / firebase-sync).
// All methods return ReadResult/WriteResult rather than throwing — the
// adapter error contract (architecture §7) crosses the boundary as typed
// values, never as exceptions.
//
// `save` is a WriteResult so adapters can surface a revision-mismatch
// Conflict at sync time. Reads (load, list) and idempotent deletes use
// ReadResult — they never conflict.
export interface CanonStorePort {
  save(item: CanonItem): Promise<WriteResult<CanonItem, DomainError>>;
  load(id: string): Promise<ReadResult<CanonItem | null, DomainError>>;
  list(): Promise<ReadResult<readonly CanonItem[], DomainError>>;
  delete(id: string): Promise<ReadResult<void, DomainError>>;
}
