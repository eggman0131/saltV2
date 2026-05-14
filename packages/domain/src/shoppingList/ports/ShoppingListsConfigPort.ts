import type { ReadResult, DomainError } from '@salt/shared-types';
import type { ShoppingListsConfig } from '../entities/ShoppingListsConfig.js';

export interface ShoppingListsConfigPort {
  load(): Promise<ReadResult<ShoppingListsConfig | null, DomainError>>;
  save(config: ShoppingListsConfig): Promise<ReadResult<void, DomainError>>;
}
