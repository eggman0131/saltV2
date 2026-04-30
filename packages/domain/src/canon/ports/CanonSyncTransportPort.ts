import type { ReadResult, WriteResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';

export interface SyncBatch {
  readonly upserted: readonly CanonItem[];
  readonly deleted: readonly string[];
}

export interface SyncPending {
  readonly initialSync: boolean;
  readonly pull: boolean;
  readonly push: boolean;
}

export interface CanonSyncTransportPort {
  pull(
    sinceCursor: string | null,
  ): Promise<ReadResult<{ items: readonly CanonItem[]; cursor: string }, DomainError>>;
  push(item: CanonItem): Promise<WriteResult<CanonItem, DomainError>>;
  subscribe(onChange: (batch: SyncBatch) => void, onError: (err: DomainError) => void): () => void;
  readonly pending: SyncPending;
}
