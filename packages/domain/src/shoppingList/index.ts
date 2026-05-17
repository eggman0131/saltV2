// Shopping list module — published surface.
// This file is the ONLY thing other domain modules and adapters are allowed
// to import from shoppingList. Anything not re-exported here is private.

export type { ShoppingList } from './entities/ShoppingList.js';
export type { ShoppingListItem, MatchState } from './entities/ShoppingListItem.js';
export type { SourceRef } from './entities/SourceRef.js';
export type { ShoppingListsConfig } from './entities/ShoppingListsConfig.js';

export type { ShoppingListPort } from './ports/ShoppingListPort.js';
export type { ShoppingListItemPort } from './ports/ShoppingListItemPort.js';
export type { ShoppingListsConfigPort } from './ports/ShoppingListsConfigPort.js';
export type { IdGenerator as ShoppingListIdGenerator } from './ports/IdGenerator.js';

export { createList } from './commands/createList.js';
export type { CreateListInput } from './commands/createList.js';
export { renameList } from './commands/renameList.js';
export type { RenameListInput } from './commands/renameList.js';
export { deleteList } from './commands/deleteList.js';
export type { DeleteListInput } from './commands/deleteList.js';
export { setDefaultList } from './commands/setDefaultList.js';
export type { SetDefaultListInput } from './commands/setDefaultList.js';
export { addItem } from './commands/addItem.js';
export type { AddItemInput } from './commands/addItem.js';
export { editItemRawText } from './commands/editItemRawText.js';
export type { EditItemRawTextInput } from './commands/editItemRawText.js';
export { editItemNotes } from './commands/editItemNotes.js';
export type { EditItemNotesInput } from './commands/editItemNotes.js';
export { checkItem } from './commands/checkItem.js';
export type { CheckItemInput } from './commands/checkItem.js';
export { uncheckItem } from './commands/uncheckItem.js';
export type { UncheckItemInput } from './commands/uncheckItem.js';
export { deleteItem } from './commands/deleteItem.js';
export type { DeleteItemInput } from './commands/deleteItem.js';
export { clearCheckedItems } from './commands/clearCheckedItems.js';
export { moveItems } from './commands/moveItems.js';
export type { MoveItemsInput, MoveItemsResult } from './commands/moveItems.js';

export { groupItemsByAisle } from './queries/groupItemsByAisle.js';
export type {
  CanonInfo,
  AisleInfo,
  OtherContributor,
  OtherBucket,
  CheckedBucket,
  ItemGroup,
  AisleGroup,
  GroupedShoppingList,
} from './queries/groupItemsByAisle.js';

export { parseShoppingListEntry } from './queries/parseEntry.js';
export type { ParsedEntry } from './queries/parseEntry.js';
