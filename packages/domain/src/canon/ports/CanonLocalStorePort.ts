import type { ReadResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export interface CanonLocalStorePort {
  upsert(item: CanonItem): Promise<ReadResult<CanonItem, DomainError>>;
  load(id: string): Promise<ReadResult<CanonItem | null, DomainError>>;
  list(): Promise<ReadResult<readonly CanonItem[], DomainError>>;
  delete(id: string): Promise<ReadResult<void, DomainError>>;
  getManifestCursor(): Promise<ReadResult<string | null, DomainError>>;
  setManifestCursor(cursor: string): Promise<ReadResult<void, DomainError>>;
  enqueuePendingWrite(item: CanonItem): Promise<ReadResult<void, DomainError>>;
  drainPendingWrites(): Promise<ReadResult<CanonItem[], DomainError>>;
}
