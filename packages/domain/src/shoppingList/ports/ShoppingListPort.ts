import type { ReadResult, DomainError } from '@salt/shared-types';
import type { ShoppingList } from '../entities/ShoppingList.js';

export interface ShoppingListPort {
  listLists(): Promise<ReadResult<readonly ShoppingList[], DomainError>>;
  createList(list: ShoppingList): Promise<ReadResult<void, DomainError>>;
  renameList(id: string, name: string, updatedAt: string): Promise<ReadResult<void, DomainError>>;
  deleteList(id: string): Promise<ReadResult<void, DomainError>>;
}
