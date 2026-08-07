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
  recordCanonPurchases,
} from '@salt/firebase-sync';
import {
  createObservabilityErrorReportingAdapter,
  startUserActionSpan,
  trackUsageEvent,
} from '@salt/observability';
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
  setItemNeedsCheck as domainSetItemNeedsCheck,
  uncheckItem,
  deleteItem,
  clearCheckedItems,
  moveItems,
  memberFirstName,
} from '@salt/domain';
import type { ShoppingList, ShoppingListItem, ShoppingListsConfig, SourceRef } from '@salt/domain';
import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { auth } from './auth.svelte.js';
import { findMemberByEmail } from './membersService.js';
import { getCanonItemsSnapshot, bumpPurchaseCounts } from './canonService.js';
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

const _itemsForActiveList = writable<readonly ShoppingListItem[]>([]);
export const itemsForActiveList: Readable<readonly ShoppingListItem[]> = _itemsForActiveList;

// Which list `itemsForActiveList` currently holds, or null before anything is
// subscribed. Exposed so callers can tell "no items" from "no list yet".
const _activeListId = writable<string | null>(null);
export const activeListId: Readable<string | null> = _activeListId;

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
  // Re-selecting the list we are already on is a no-op: tearing the subscription
  // down and back up would blank the items for a frame and re-read them for
  // nothing. It also lets a page ask for the default list without caring whether
  // someone got there first (see the config subscription in initShoppingListSync).
  if (get(_activeListId) === listId && _unsubItems) return;
  _unsubItems?.();
  _activeListId.set(listId);
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
  _activeListId.set(null);

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
      // Subscribe the DEFAULT list's items at boot unless a page has already
      // chosen a list (issue #634). The personal view and its nav badge read the
      // list from any page — "2 items need a check" has to be answerable before
      // the shopping page has ever been opened. It also means the shopping page
      // paints its items immediately instead of subscribing on mount.
      const defaultId = config?.defaultListId;
      if (defaultId && get(_activeListId) === null) setActiveListId(defaultId);
      markLoaded('config');
    },
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
  );

  return () => {
    unsubLists();
    unsubConfig();
    _unsubItems?.();
    _unsubItems = null;
    _activeListId.set(null);
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
    // User-typed adds only (issue #684) — recipe extraction commits elsewhere
    // and is deliberately not counted here. Id only, never the rawText.
    else trackUsageEvent('shopping.item_added', { list_id: listId });
    return reportIfFailed(getErrorReporter(), saveResult);
  } finally {
    // End once the write settles so the span captures client-side latency.
    span.end();
  }
}

// ─── Default-list add (cook mode long-press, issue #714) ─────────────────────

/** What the caller needs to name the list in a toast and to undo the add. */
export interface QuickAddResult {
  readonly itemId: string;
  readonly listId: string;
  readonly listName: string;
}

/**
 * Which list a surface that is NOT the shopping page should write to: the
 * household default, falling back to the first list when no default is
 * configured, and `null` when there are no lists at all.
 *
 * `_defaultListId` is tri-state — `undefined` (config not loaded yet), `null`
 * (loaded, no config doc), or an id. Only the id branch is authoritative, and
 * even then the doc it names can be stale (a deleted list leaves the config
 * pointing at nothing), so the id is resolved AGAINST `_lists` rather than
 * trusted. Every other state lands on the same first-list fallback.
 */
function resolveTargetList(): ShoppingList | null {
  const all = get(_lists);
  if (all.length === 0) return null;
  const defaultId = get(_defaultListId);
  if (typeof defaultId === 'string') {
    const found = all.find((l) => l.id === defaultId);
    if (found) return found;
  }
  return all[0]!;
}

/**
 * Add one name-only item to the DEFAULT list, from a surface that has no list of
 * its own (cook mode's mise rows and step pills, issue #714).
 *
 * Deliberately NOT `addItemToList`. That one composes over `get(_itemsForActiveList)`
 * — and in cook mode the active list is not necessarily the default list, and its
 * items may not be loaded at all, so the composition would be against the wrong
 * array (or an empty one that merely LOOKS right). `addItem` does no dedupe and no
 * cross-item logic — it validates `rawText` and appends — so passing `[]` is
 * exactly equivalent for a single add, and is active-list-independent by
 * construction. The written document is shape-identical to a manual add from the
 * shopping page: same domain command, same `manual` SourceRef, no bespoke fields.
 *
 * `NotFound` when there is no list to add to. That category is suppressed by the
 * reporting gate on purpose — "this household has no shopping list yet" is an
 * expected state, and the caller answers it with a gentle informational toast.
 */
export async function addItemToDefaultList(
  rawText: string,
): Promise<ReadResult<QuickAddResult, DomainError>> {
  const list = resolveTargetList();
  if (!list) return failure({ kind: 'NotFound', resource: 'shopping-list', id: '' });

  const now = new Date().toISOString();
  const member = findMemberByEmail(auth.user?.email);
  const addedBy = member ? memberFirstName(member.name) : '';
  const source: SourceRef = addedBy ? { kind: 'manual', addedBy } : { kind: 'manual' };
  const result = addItem([], { rawText, source, now }, ids);
  if (result.kind !== 'ok') return result;
  const newItem = result.value[0]!;

  // Same trace shape as addItemToList: root a browser action span so the write,
  // the onShoppingListItemWrite canon-match trigger and the icon trigger render
  // as ONE trace. Inert no-op when tracing is off.
  const span = startUserActionSpan(`Add item: ${rawText}`);
  try {
    const traceparent = span.traceparent || undefined;
    const saveResult = await saveShoppingListItem(list.id, newItem, traceparent);
    if (saveResult.kind === 'err') {
      span.setError(saveResult.error);
      return reportIfFailed(getErrorReporter(), saveResult);
    }
    // A user-typed add by any other name — the existing event, not a new one
    // (`UsageEventMap` is a closed union owned by @salt/observability).
    trackUsageEvent('shopping.item_added', { list_id: list.id });
    return success({ itemId: newItem.id, listId: list.id, listName: list.name });
  } finally {
    span.end();
  }
}

/**
 * Delete one item from a NAMED list — the undo half of `addItemToDefaultList`.
 *
 * Separate from `removeItem` because that one runs the item through
 * `deleteItem` against `_itemsForActiveList`, which the cook-mode add's target
 * list is not guaranteed to be. Undo already holds the id it just created, so
 * there is nothing to look up and no active-list guard to satisfy.
 */
export async function deleteItemFromList(
  listId: string,
  itemId: string,
): Promise<ReadResult<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await deleteShoppingListItem(listId, itemId));
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

// The purchase signal (issue #725): one event per item ticked off, fired only
// in the tick direction and only after that item's own write succeeded. The
// canon name is looked up from the already-subscribed canon snapshot; the
// item's rawText is never attached (the scrubbing rule, usageEvents.ts).
function trackItemPurchased(item: ShoppingListItem): void {
  const canonName = item.canonId
    ? (getCanonItemsSnapshot().find((c) => c.id === item.canonId)?.name ?? null)
    : null;
  trackUsageEvent('shopping.item_purchased', {
    canon_id: item.canonId,
    canon_name: canonName,
    item_source: item.sources.some((s) => s.kind === 'recipe') ? 'recipe' : 'manual',
  });
}

// The purchase-count sink (issue #726) — the same tick-off gesture the event
// above reports, persisted so the add field can rank by what we actually buy.
//
// One call per GESTURE, not per item: a 30-item bulk tick-off becomes one write
// carrying 30 field transforms rather than 30 writes to one shared document.
// Rows with no canon match have no key to count against and are skipped.
//
// Fire-and-forget, and deliberately not awaited: `setDoc` does not settle until
// the server acknowledges, so awaiting it would stall the tick-off for the whole
// time the shopper is offline — exactly when this data gets made. A failure is
// reported (it is a StorageError) but never reaches the shopper, whose own write
// already landed.
function recordPurchases(items: readonly ShoppingListItem[]): void {
  const canonIds = items.map((i) => i.canonId).filter((id): id is string => id !== null);
  if (canonIds.length === 0) return;
  bumpPurchaseCounts(canonIds);
  void recordCanonPurchases(canonIds).then((result) => reportIfFailed(getErrorReporter(), result));
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
  const saveResult = await saveShoppingListItem(listId, updated);
  // Only the tick-off direction is usage (issue #684); unchecking is a correction.
  if (!item.checked && saveResult.kind === 'ok') {
    trackUsageEvent('shopping.item_completed', { list_id: listId, item_count: 1 });
    trackItemPurchased(updated);
    recordPurchases([updated]);
  }
  return reportIfFailed(getErrorReporter(), saveResult);
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

// Raise or clear an item's verification flag from the edit sheet (issue #694).
// The clearing direction produces exactly the write the row's ✓ does — same
// pure command, so the two entry points cannot diverge.
export async function setItemNeedsCheck(
  listId: string,
  itemId: string,
  needsCheck: boolean,
): Promise<ReadResult<void, DomainError>> {
  const items = get(_itemsForActiveList);
  const now = new Date().toISOString();
  const result = domainSetItemNeedsCheck(items, { id: itemId, needsCheck, now });
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
  // One gesture, one event: a bulk completion carries its size rather than
  // firing per item (issue #684).
  if (results.some((r) => r.kind === 'ok'))
    trackUsageEvent('shopping.item_completed', { list_id: listId, item_count: toSave.length });
  // The purchase signal is the opposite granularity — one per item that saved
  // (issue #725). results is index-aligned with toSave.
  const saved = toSave.filter((_, i) => results[i]!.kind === 'ok');
  for (const item of saved) trackItemPurchased(item);
  // ...and the counts go back to gesture granularity: one write, N transforms.
  recordPurchases(saved);
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

export interface ItemEdits {
  readonly rawText: string;
  readonly amount: number | undefined;
  readonly unit: string | undefined;
  readonly notes: string;
  readonly needsCheck: boolean;
}

// Apply the edit sheet's fields AND move the item to another list, as one write
// (issue #694). The edits must ride along INSIDE the moved document: they are
// composed over the items array in memory, and only the final item is handed to
// the batch. Writing the fields first and then calling moveSelectedItems would
// lose them — that function re-reads `_itemsForActiveList`, which is fed by a
// Firestore snapshot listener and is not guaranteed to show a write issued in
// the same tick, so the batch could carry the PRE-EDIT item to the destination
// and delete the edited one from the source.
//
// Validation short-circuits before anything is written: editItemRawText rejects
// an empty rawText with INVALID_ITEM_RAW_TEXT, and no batch is issued.
export async function moveItemWithEdits(
  sourceListId: string,
  targetListId: string,
  itemId: string,
  edits: ItemEdits,
): Promise<ReadResult<void, DomainError>> {
  const now = new Date().toISOString();
  const withRawText = editItemRawText(get(_itemsForActiveList), {
    id: itemId,
    rawText: edits.rawText,
    now,
  });
  if (withRawText.kind !== 'ok') return withRawText;
  const withAmountUnit = editItemAmountUnit(withRawText.value, {
    id: itemId,
    amount: edits.amount,
    unit: edits.unit,
    now,
  });
  if (withAmountUnit.kind !== 'ok') return withAmountUnit;
  const withNotes = editItemNotes(withAmountUnit.value, { id: itemId, notes: edits.notes, now });
  if (withNotes.kind !== 'ok') return withNotes;
  const withNeedsCheck = domainSetItemNeedsCheck(withNotes.value, {
    id: itemId,
    needsCheck: edits.needsCheck,
    now,
  });
  if (withNeedsCheck.kind !== 'ok') return withNeedsCheck;
  const moved = moveItems(withNeedsCheck.value, [], { itemIds: [itemId], now });
  if (moved.kind !== 'ok') return moved;
  return reportIfFailed(
    getErrorReporter(),
    await moveShoppingListItems(sourceListId, targetListId, moved.value.targetItems),
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
  _itemsForActiveList.set([]);
  _activeListId.set(null);
  _isLoadingShoppingList.set(true);
  _receivedLists = false;
  _receivedConfig = false;
  _receivedItems = false;
  _unsubItems?.();
  _unsubItems = null;
  _errorReporter = null;
}
