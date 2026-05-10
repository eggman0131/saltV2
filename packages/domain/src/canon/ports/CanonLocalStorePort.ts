import type { ReadResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export interface CanonLocalStorePort {
  upsert(item: CanonItem): Promise<ReadResult<CanonItem, DomainError>>;
  load(id: string): Promise<ReadResult<CanonItem | null, DomainError>>;
  list(): Promise<ReadResult<readonly CanonItem[], DomainError>>;
  delete(id: string): Promise<ReadResult<void, DomainError>>;
}
