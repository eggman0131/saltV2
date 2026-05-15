import {
  subscribeShoppingLists,
  createShoppingList,
  renameShoppingList,
  deleteShoppingList,
  subscribeShoppingListItems,
  saveShoppingListItem,
  deleteShoppingListItem,
  deleteShoppingListItems,
  moveShoppingListItems,
  subscribeShoppingListsConfig,
  saveShoppingListsConfig,
} from '@salt/firebase-sync';
import { createLDErrorReportingAdapter } from '@salt/ld-observability';
import {
  createList,
  renameList,
  deleteList,
  setDefaultList,
  addItem,
  editItemRawText,
  editItemNotes,
  checkItem,
  uncheckItem,
  deleteItem,
  clearCheckedItems,
  moveItems,
} from '@salt/domain';
import type { ShoppingList, ShoppingListItem, ShoppingListsConfig } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// ─── ID generators ───────────────────────────────────────────────────────────

const ids = {
  newListId: () => crypto.randomUUID(),
  newItemId: () => crypto.randomUUID(),
};

// ─── Reactive stores ─────────────────────────────────────────────────────────

const _lists = writable<readonly ShoppingList[]>([]);
export const lists: Readable<readonly ShoppingList[]> = _lists;

// undefined = not yet loaded; null = loaded but no config doc; string = loaded with default
const _defaultListId = writable<string | null | undefined>(undefined);
export const defaultListId: Readable<string | null | undefined> = _defaultListId;

const _activeListId = writable<string | null>(null);
export const activeListId: Readable<string | null> = _activeListId;

const _itemsForActiveList = writable<readonly ShoppingListItem[]>([]);
export const itemsForActiveList: Readable<readonly ShoppingListItem[]> = _itemsForActiveList;

const _isLoadingShoppingList = writable(true);
export const isLoadingShoppingList: Readable<boolean> = _isLoadingShoppingList;

// ─── Error reporting ─────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createLDErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createLDErrorReportingAdapter();
  return _errorReporter;
}

// ─── Loading state tracking ──────────────────────────────────────────────────

let _receivedLists = false;
let _receivedConfig = false;
let _receivedItems = false;

function markLoaded(scope: 'lists' | 'config' | 'items'): void {
  if (scope === 'lists') _receivedLists = true;
  if (scope === 'config') _receivedConfig = true;
  if (scope === 'items') _receivedItems = true;
  if (_receivedLists && _receivedConfig && _receivedItems) _isLoadingShoppingList.set(false);
}

// ─── Items subscription (driven by active list) ───────────────────────────────

let _unsubItems: (() => void) | null = null;

export function setActiveListId(listId: string): void {
  _activeListId.set(listId);
  _unsubItems?.();
  _itemsForActiveList.set([]);
  const errors = getErrorReporter();
  _unsubItems = subscribeShoppingListItems(
    listId,
    (items) => {
      _itemsForActiveList.set(items);
      markLoaded('items');
    },
    (err) => errors.report(err),
  );
}

// ─── Init / cleanup ───────────────────────────────────────────────────────────

export function initShoppingListSync(): () => void {
  _isLoadingShoppingList.set(true);
  _receivedLists = false;
  _receivedConfig = false;
  _receivedItems = false;
  _lists.set([]);
  _defaultListId.set(undefined);
  _itemsForActiveList.set([]);

  const errors = getErrorReporter();

  const unsubLists = subscribeShoppingLists(
    (incoming) => {
      _lists.set(incoming);
      markLoaded('lists');
    },
    (err) => errors.report(err),
  );

  const unsubConfig = subscribeShoppingListsConfig(
    (config) => {
      _defaultListId.set(config?.defaultListId ?? null);
      markLoaded('config');
    },
    (err) => errors.report(err),
  );

  return () => {
    unsubLists();
    unsubConfig();
    _unsubItems?.();
    _unsubItems = null;
  };
}

// ─── List commands ────────────────────────────────────────────────────────────

export async function addList(name: string): Promise<ReadResult<ShoppingList, DomainError>> {
  const now = new Date().toISOString();
  const result = createList({ name, now }, ids);
  if (result.kind !== 'ok') return result;
  const list = result.value;
  const saveResult = await createShoppingList(list);
  if (saveResult.kind !== 'ok') return saveResult;
  if (!get(_defaultListId)) {
    const config: ShoppingListsConfig = { defaultListId: list.id, schemaVersion: 1 };
    await saveShoppingListsConfig(config);
  }
  return result;
}

export async function renameListById(
  id: string,
  name: string,
): Promise<ReadResult<void, DomainError>> {
  const now = new Date().toISOString();
  const domainResult = renameList(get(_lists), { id, name, now });
  if (domainResult.kind !== 'ok') return domainResult;
  const updated = domainResult.value.find((l) => l.id === id)!;
  return renameShoppingList(id, updated.name, updated.updatedAt);
}

export async function removeList(id: string): Promise<ReadResult<void, DomainError>> {
  const defaultId = get(_defaultListId) ?? '';
  const config: ShoppingListsConfig = { defaultListId: defaultId, schemaVersion: 1 };
  const domainResult = deleteList(get(_lists), config, { id });
  if (domainResult.kind !== 'ok') return domainResult;
  return deleteShoppingList(id);
}

export async function changeDefaultList(listId: string): Promise<ReadResult<void, DomainError>> {
  const defaultId = get(_defaultListId) ?? '';
  const config: ShoppingListsConfig = { defaultListId: defaultId, schemaVersion: 1 };
  const domainResult = setDefaultList(get(_lists), config, { listId });
  if (domainResult.kind !== 'ok') return domainResult;
  return saveShoppingListsConfig(domainResult.value);
}

// ─── Item commands ────────────────────────────────────────────────────────────

export async function addItemToList(
  listId: string,
  rawText: string,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = addItem(items, { rawText, source: { kind: 'manual' }, now }, ids);
  if (result.kind !== 'ok') return result;
  const newItem = result.value[result.value.length - 1]!;
  return saveShoppingListItem(listId, newItem);
}

export async function updateItemRawText(
  listId: string,
  itemId: string,
  rawText: string,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = editItemRawText(items, { id: itemId, rawText, now });
  if (result.kind !== 'ok') return result;
  const updated = result.value.find((i) => i.id === itemId)!;
  return saveShoppingListItem(listId, updated);
}

export async function updateItemNotes(
  listId: string,
  itemId: string,
  notes: string,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = editItemNotes(items, { id: itemId, notes, now });
  if (result.kind !== 'ok') return result;
  const updated = result.value.find((i) => i.id === itemId)!;
  return saveShoppingListItem(listId, updated);
}

export async function toggleItemChecked(
  listId: string,
  item: ShoppingListItem,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = item.checked
    ? uncheckItem(items, { id: item.id, now })
    : checkItem(items, { id: item.id, now });
  if (result.kind !== 'ok') return result;
  const updated = result.value.find((i) => i.id === item.id)!;
  return saveShoppingListItem(listId, updated);
}

export async function checkItems(listId: string, itemIds: readonly string[]): Promise<void> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  let working = [...items];
  for (const id of itemIds) {
    const result = checkItem(working, { id, now });
    if (result.kind === 'ok') working = result.value;
  }
  const toSave = working.filter((i) => itemIds.includes(i.id));
  await Promise.all(toSave.map((item) => saveShoppingListItem(listId, item)));
}

export async function uncheckItems(listId: string, itemIds: readonly string[]): Promise<void> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  let working = [...items];
  for (const id of itemIds) {
    const result = uncheckItem(working, { id, now });
    if (result.kind === 'ok') working = result.value;
  }
  const toSave = working.filter((i) => itemIds.includes(i.id));
  await Promise.all(toSave.map((item) => saveShoppingListItem(listId, item)));
}

export async function removeItem(
  listId: string,
  itemId: string,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const result = deleteItem(items, { id: itemId });
  if (result.kind !== 'ok') return result;
  return deleteShoppingListItem(listId, itemId);
}

export async function removeItems(
  listId: string,
  itemIds: readonly string[],
): Promise<ReadResult<void, DomainError>> {
  return deleteShoppingListItems(listId, itemIds);
}

export async function clearChecked(listId: string): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const checkedIds = items.filter((i) => i.checked).map((i) => i.id);
  if (checkedIds.length === 0) return { kind: 'ok', value: undefined };
  return deleteShoppingListItems(listId, checkedIds);
}

export async function moveSelectedItems(
  sourceListId: string,
  targetListId: string,
  itemIds: readonly string[],
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = moveItems(items, [], { itemIds, now });
  if (result.kind !== 'ok') return result;
  return moveShoppingListItems(sourceListId, targetListId, result.value.targetItems);
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export function getShoppingListsSnapshot(): readonly ShoppingList[] {
  return get(_lists);
}

export function getDefaultListIdSnapshot(): string | null | undefined {
  return get(_defaultListId);
}

export function getItemsSnapshot(): readonly ShoppingListItem[] {
  return get(_itemsForActiveList);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

export function __resetShoppingListServiceForTest(): void {
  _lists.set([]);
  _defaultListId.set(undefined);
  _activeListId.set(null);
  _itemsForActiveList.set([]);
  _isLoadingShoppingList.set(true);
  _receivedLists = false;
  _receivedConfig = false;
  _receivedItems = false;
  _unsubItems?.();
  _unsubItems = null;
  _errorReporter = null;
}
