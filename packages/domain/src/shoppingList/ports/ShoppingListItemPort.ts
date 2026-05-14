import type { ReadResult, DomainError } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface ShoppingListItemPort {
  listItems(listId: string): Promise<ReadResult<readonly ShoppingListItem[], DomainError>>;
  saveItem(listId: string, item: ShoppingListItem): Promise<ReadResult<void, DomainError>>;
  deleteItem(listId: string, itemId: string): Promise<ReadResult<void, DomainError>>;
  deleteItems(listId: string, itemIds: readonly string[]): Promise<ReadResult<void, DomainError>>;
  moveItems(
    sourceListId: string,
    targetListId: string,
    items: readonly ShoppingListItem[],
  ): Promise<ReadResult<void, DomainError>>;
}
