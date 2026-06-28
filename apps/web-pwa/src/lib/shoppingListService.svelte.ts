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
import { createObservabilityErrorReportingAdapter, startUserActionSpan } from '@salt/observability';
import {
  createList,
  renameList,
  deleteList,
  setDefaultList,
  addItem,
  editItemRawText,
  editItemNotes,
  editItemAmountUnit,
  checkItem,
  confirmItemNeeded as domainConfirmItemNeeded,
  uncheckItem,
  deleteItem,
  clearCheckedItems,
  moveItems,
  memberFirstName,
} from '@salt/domain';
import type { ShoppingList, ShoppingListItem, ShoppingListsConfig, SourceRef } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { auth } from './auth.svelte.js';
import { findMemberByEmail } from './membersService.js';
import { reportIfFailed, reportSubscriptionError, reportWriteError } from './errorReporting.js';

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

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// Bulk write helper: the multi-item commands (checkItems/uncheckItems/
// confirmItemsNeeded) fan out N saveShoppingListItem writes and return void.
// Report the FIRST failing write among them (the gate drops suppressed
// categories); a single failed write in a batch is enough signal.
function reportFirstWriteFailure(results: readonly ReadResult<void, DomainError>[]): void {
  const firstFailure = results.find((r) => r.kind === 'err');
  if (firstFailure && firstFailure.kind === 'err') {
    reportWriteError(getErrorReporter(), firstFailure.error);
  }
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
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
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
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
  );

  const unsubConfig = subscribeShoppingListsConfig(
    (config) => {
      _defaultListId.set(config?.defaultListId ?? null);
      markLoaded('config');
    },
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
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
  if (saveResult.kind !== 'ok') {
    if (saveResult.kind === 'err') reportWriteError(getErrorReporter(), saveResult.error);
    return saveResult;
  }
  if (!get(_defaultListId)) {
    const config: ShoppingListsConfig = { defaultListId: list.id, schemaVersion: 1 };
    const configResult = await saveShoppingListsConfig(config);
    if (configResult.kind === 'err') reportWriteError(getErrorReporter(), configResult.error);
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
  return reportIfFailed(
    getErrorReporter(),
    await renameShoppingList(id, updated.name, updated.updatedAt),
  );
}

export async function removeList(id: string): Promise<ReadResult<void, DomainError>> {
  const defaultId = get(_defaultListId) ?? '';
  const config: ShoppingListsConfig = { defaultListId: defaultId, schemaVersion: 1 };
  const domainResult = deleteList(get(_lists), config, { id });
  if (domainResult.kind !== 'ok') return domainResult;
  return reportIfFailed(getErrorReporter(), await deleteShoppingList(id));
}

export async function changeDefaultList(listId: string): Promise<ReadResult<void, DomainError>> {
  const defaultId = get(_defaultListId) ?? '';
  const config: ShoppingListsConfig = { defaultListId: defaultId, schemaVersion: 1 };
  const domainResult = setDefaultList(get(_lists), config, { listId });
  if (domainResult.kind !== 'ok') return domainResult;
  return reportIfFailed(getErrorReporter(), await saveShoppingListsConfig(domainResult.value));
}

// ─── Item commands ────────────────────────────────────────────────────────────

export async function addItemToList(
  listId: string,
  rawText: string,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  // Stamp the adder's first name onto the manual source when we can resolve
  // their member doc; otherwise leave it off (back-compatible plain manual).
  const member = findMemberByEmail(auth.user?.email);
  const addedBy = member ? memberFirstName(member.name) : '';
  const source: SourceRef = addedBy ? { kind: 'manual', addedBy } : { kind: 'manual' };
  const result = addItem(items, { rawText, source, now }, ids);
  if (result.kind !== 'ok') return result;
  const newItem = result.value[result.value.length - 1]!;

  // Distributed tracing (issue #362, Phase 5): root a browser action span so the
  // whole "add to shopping list" path — the doc write, the onShoppingListItemWrite
  // canon-match trigger, and the onCanonItemWritten icon trigger — renders as ONE
  // trace. We hand the span's W3C traceparent to saveShoppingListItem, which
  // stamps it onto the doc as `traceContext` for the triggers to continue. Inert
  // no-op when tracing is off (empty traceparent → no field written). NOT the
  // canon fast-path's inert startSpan shim — this is the real browser tracer.
  const span = startUserActionSpan(`Add item: ${rawText}`);
  try {
    const traceparent = span.traceparent || undefined;
    const saveResult = await saveShoppingListItem(listId, newItem, traceparent);
    if (saveResult.kind === 'err') span.setError(saveResult.error);
    return reportIfFailed(getErrorReporter(), saveResult);
  } finally {
    // End once the write settles so the span captures client-side latency.
    span.end();
  }
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
  return reportIfFailed(getErrorReporter(), await saveShoppingListItem(listId, updated));
}

export async function updateItemAmountUnit(
  listId: string,
  itemId: string,
  amount: number | undefined,
  unit: string | undefined,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = editItemAmountUnit(items, { id: itemId, amount, unit, now });
  if (result.kind !== 'ok') return result;
  const updated = result.value.find((i) => i.id === itemId)!;
  return reportIfFailed(getErrorReporter(), await saveShoppingListItem(listId, updated));
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
  return reportIfFailed(getErrorReporter(), await saveShoppingListItem(listId, updated));
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
  return reportIfFailed(getErrorReporter(), await saveShoppingListItem(listId, updated));
}

// Clear an item's verification flag — the shopper confirmed they need it (issue
// #185). Dropping an unwanted flagged item uses removeItem instead.
export async function confirmItemNeeded(
  listId: string,
  itemId: string,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = domainConfirmItemNeeded(items, { id: itemId, now });
  if (result.kind !== 'ok') return result;
  const updated = result.value.find((i) => i.id === itemId)!;
  return reportIfFailed(getErrorReporter(), await saveShoppingListItem(listId, updated));
}

// Clear the verification flag on several items at once — confirming a combined
// row that several recipe contributions flagged (issue #184/#185).
export async function confirmItemsNeeded(
  listId: string,
  itemIds: readonly string[],
): Promise<void> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  let working = [...items];
  for (const id of itemIds) {
    const result = domainConfirmItemNeeded(working, { id, now });
    if (result.kind === 'ok') working = result.value;
  }
  const toSave = working.filter((i) => itemIds.includes(i.id));
  const results = await Promise.all(toSave.map((item) => saveShoppingListItem(listId, item)));
  reportFirstWriteFailure(results);
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
  const results = await Promise.all(toSave.map((item) => saveShoppingListItem(listId, item)));
  reportFirstWriteFailure(results);
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
  const results = await Promise.all(toSave.map((item) => saveShoppingListItem(listId, item)));
  reportFirstWriteFailure(results);
}

export async function removeItem(
  listId: string,
  itemId: string,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const result = deleteItem(items, { id: itemId });
  if (result.kind !== 'ok') return result;
  return reportIfFailed(getErrorReporter(), await deleteShoppingListItem(listId, itemId));
}

export async function removeItems(
  listId: string,
  itemIds: readonly string[],
): Promise<ReadResult<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await deleteShoppingListItems(listId, itemIds));
}

export async function clearChecked(listId: string): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const checkedIds = items.filter((i) => i.checked).map((i) => i.id);
  if (checkedIds.length === 0) return { kind: 'ok', value: undefined };
  return reportIfFailed(getErrorReporter(), await deleteShoppingListItems(listId, checkedIds));
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
  return reportIfFailed(
    getErrorReporter(),
    await moveShoppingListItems(sourceListId, targetListId, result.value.targetItems),
  );
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
