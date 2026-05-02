import type { ReadResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

/** Identifies which entity scope the manifest cursor belongs to. */
export type CursorScope = 'items' | 'aisles';

export interface CanonLocalStorePort {
  upsert(item: CanonItem): Promise<ReadResult<CanonItem, DomainError>>;
  load(id: string): Promise<ReadResult<CanonItem | null, DomainError>>;
  list(): Promise<ReadResult<readonly CanonItem[], DomainError>>;
  delete(id: string): Promise<ReadResult<void, DomainError>>;
  getCursor(scope: CursorScope): Promise<ReadResult<number | null, DomainError>>;
  setCursor(scope: CursorScope, value: number): Promise<ReadResult<void, DomainError>>;
  enqueuePendingWrite(item: CanonItem): Promise<ReadResult<void, DomainError>>;
  drainPendingWrites(): Promise<ReadResult<CanonItem[], DomainError>>;
}
