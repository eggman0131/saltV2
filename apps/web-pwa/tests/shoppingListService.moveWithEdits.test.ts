/**
 * moveItemWithEdits — the edit sheet's "edit and move in one visit" path (#694).
 *
 * The regression this guards is silent data loss: if the field edits were
 * written separately and the move issued afterwards, the move would re-read the
 * snapshot-fed store and batch the PRE-EDIT item to the destination, deleting
 * the edited one from the source. So these tests assert on what actually
 * reaches the adapter batch, and that no per-field write is issued alongside it.
 */
import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { ShoppingListItem } from '@salt/domain';

vi.mock('@salt/firebase-sync', () => ({
  subscribeShoppingLists: vi.fn(),
  createShoppingList: vi.fn(),
  renameShoppingList: vi.fn(),
  deleteShoppingList: vi.fn(),
  subscribeShoppingListItems: vi.fn(),
  saveShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteShoppingListItem: vi.fn(),
  deleteShoppingListItems: vi.fn(),
  moveShoppingListItems: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  subscribeShoppingListsConfig: vi.fn(),
  saveShoppingListsConfig: vi.fn(),
  subscribeMembers: vi.fn(),
  upsertMember: vi.fn(),
  deleteMember: vi.fn(),
  isAuthTransitioning: vi.fn(() => false),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  trackUsageEvent: vi.fn(),
  startUserActionSpan: vi.fn(() => ({
    traceparent: '',
    child: vi.fn(() => ({ setError: vi.fn(), end: vi.fn() })),
    setError: vi.fn(),
    setAttribute: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: null as { uid: string; email: string | null } | null },
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  moveItemWithEdits,
  setActiveListId,
  __resetShoppingListServiceForTest,
} from '../src/lib/shoppingListService.svelte.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const NOW = '2026-06-07T00:00:00.000Z';

function item(overrides: Partial<ShoppingListItem> & { id: string }): ShoppingListItem {
  return {
    rawText: 'paprika',
    notes: '',
    sources: [{ kind: 'manual' }],
    canonId: 'canon-paprika',
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// Seed the active-list store the only way production does — through the
// subscription callback — rather than adding a test-only setter.
function seedItems(listId: string, items: ShoppingListItem[]): void {
  fs.subscribeShoppingListItems.mockImplementation((_id, onItems) => {
    onItems(items);
    return () => {};
  });
  setActiveListId(listId);
}

function movedItems(): readonly ShoppingListItem[] {
  return fs.moveShoppingListItems.mock.calls[0]![2];
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.moveShoppingListItems.mockResolvedValue({ kind: 'ok', value: undefined });
  __resetShoppingListServiceForTest();
});

describe('moveItemWithEdits', () => {
  it('carries every field edit into the moved document', async () => {
    seedItems('list-a', [item({ id: 'item-1' }), item({ id: 'item-2', rawText: 'salt' })]);

    const result = await moveItemWithEdits('list-a', 'list-b', 'item-1', {
      rawText: 'smoked paprika',
      amount: 2,
      unit: 'tsp',
      notes: 'the hot one',
      needsCheck: true,
    });

    expect(result.kind).toBe('ok');
    expect(fs.moveShoppingListItems).toHaveBeenCalledTimes(1);
    expect(fs.moveShoppingListItems.mock.calls[0]![0]).toBe('list-a');
    expect(fs.moveShoppingListItems.mock.calls[0]![1]).toBe('list-b');

    const moved = movedItems();
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      id: 'item-1',
      rawText: 'smoked paprika',
      amount: 2,
      unit: 'tsp',
      notes: 'the hot one',
      needsCheck: true,
    });
  });

  it('issues no per-field write alongside the batch', async () => {
    seedItems('list-a', [item({ id: 'item-1' })]);

    await moveItemWithEdits('list-a', 'list-b', 'item-1', {
      rawText: 'smoked paprika',
      amount: undefined,
      unit: undefined,
      notes: 'note',
      needsCheck: true,
    });

    // A separate saveShoppingListItem would be the pre-edit-clobber bug: the
    // batch is the ONLY write on this path.
    expect(fs.saveShoppingListItem).not.toHaveBeenCalled();
  });

  it('drops amount and unit when they are cleared', async () => {
    seedItems('list-a', [item({ id: 'item-1', amount: 3, unit: 'kg' })]);

    await moveItemWithEdits('list-a', 'list-b', 'item-1', {
      rawText: 'paprika',
      amount: undefined,
      unit: undefined,
      notes: '',
      needsCheck: false,
    });

    const moved = movedItems();
    expect(moved[0]).not.toHaveProperty('amount');
    expect(moved[0]).not.toHaveProperty('unit');
  });

  it('keeps parity with the bulk move — an unedited item keeps its canon match', async () => {
    // Issue #699. The sheet always submits its text field, so this path used to
    // reset the match on every single-item move while the bulk move (after #699)
    // preserves it. Byte-identical documents from both entry points is the
    // contract; this is the assertion that holds it.
    seedItems('list-a', [item({ id: 'item-1' })]);

    await moveItemWithEdits('list-a', 'list-b', 'item-1', {
      rawText: 'paprika',
      amount: undefined,
      unit: undefined,
      notes: '',
      needsCheck: false,
    });

    expect(movedItems()[0]).toMatchObject({
      canonId: 'canon-paprika',
      matchState: 'matched',
    });
  });

  it('clears the canon match when the sheet actually edited the text', async () => {
    // Editing the text is the one thing that genuinely invalidates a match, and
    // it still does — whether or not the same save also moves the item (#699).
    seedItems('list-a', [item({ id: 'item-1' })]);

    await moveItemWithEdits('list-a', 'list-b', 'item-1', {
      rawText: 'smoked paprika',
      amount: undefined,
      unit: undefined,
      notes: '',
      needsCheck: false,
    });

    expect(movedItems()[0]).toMatchObject({
      rawText: 'smoked paprika',
      canonId: null,
      matchState: 'pending',
    });
  });

  it('rejects an empty rawText and writes nothing', async () => {
    seedItems('list-a', [item({ id: 'item-1' })]);

    const result = await moveItemWithEdits('list-a', 'list-b', 'item-1', {
      rawText: '   ',
      amount: undefined,
      unit: undefined,
      notes: '',
      needsCheck: false,
    });

    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error.kind).toBe('ValidationError');
    expect(fs.moveShoppingListItems).not.toHaveBeenCalled();
    expect(fs.saveShoppingListItem).not.toHaveBeenCalled();
  });

  it('returns NotFound for an unknown item and writes nothing', async () => {
    seedItems('list-a', [item({ id: 'item-1' })]);

    const result = await moveItemWithEdits('list-a', 'list-b', 'no-such', {
      rawText: 'paprika',
      amount: undefined,
      unit: undefined,
      notes: '',
      needsCheck: false,
    });

    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({
      kind: 'NotFound',
      resource: 'shoppingListItem',
      id: 'no-such',
    });
    expect(fs.moveShoppingListItems).not.toHaveBeenCalled();
  });

  it('surfaces an adapter failure rather than throwing', async () => {
    seedItems('list-a', [item({ id: 'item-1' })]);
    fs.moveShoppingListItems.mockResolvedValue({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });

    const result = await moveItemWithEdits('list-a', 'list-b', 'item-1', {
      rawText: 'paprika',
      amount: undefined,
      unit: undefined,
      notes: '',
      needsCheck: false,
    });

    expect(result.kind).toBe('err');
  });
});
