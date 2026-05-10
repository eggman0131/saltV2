import type { ReadResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';

export interface AisleLocalStorePort {
  save(aisles: readonly Aisle[]): Promise<ReadResult<void, DomainError>>;
  load(): Promise<ReadResult<readonly Aisle[] | null, DomainError>>;
}
