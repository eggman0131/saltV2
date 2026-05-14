import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@salt/shared-types';
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
import type {
  ShoppingList,
  ShoppingListItem,
  ShoppingListsConfig,
  ShoppingListIdGenerator,
} from '@salt/domain';

// ── helpers ──────────────────────────────────────────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z';
const NOW2 = '2026-01-02T00:00:00.000Z';

let seq = 0;
function makeIds(): ShoppingListIdGenerator {
  return {
    newListId: () => `list-${++seq}`,
    newItemId: () => `item-${++seq}`,
  };
}

function makeList(id: string, overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id,
    name: 'Weekly Shop',
    schemaVersion: 1 as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeConfig(defaultListId: string): ShoppingListsConfig {
  return { defaultListId, schemaVersion: 1 as const };
}

function makeItem(id: string, overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id,
    rawText: 'milk 2L',
    notes: '',
    sources: [{ kind: 'manual' }],
    canonId: null,
    matchState: 'pending',
    checked: false,
    schemaVersion: 1 as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ── createList ────────────────────────────────────────────────────────────────

describe('createList', () => {
  it('creates a list with trimmed name', () => {
    const result = createList({ name: '  Weekly Shop  ', now: NOW }, makeIds());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.name).toBe('Weekly Shop');
    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.createdAt).toBe(NOW);
    expect(result.value.id).toMatch(/^list-/);
  });

  it('returns INVALID_LIST_NAME for blank name', () => {
    const result = createList({ name: '   ', now: NOW }, makeIds());
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.INVALID_LIST_NAME });
  });
});

// ── renameList ────────────────────────────────────────────────────────────────

describe('renameList', () => {
  it('renames the list and stamps updatedAt', () => {
    const lists = [makeList('list-1', { name: 'Old Name' })];
    const result = renameList(lists, { id: 'list-1', name: 'New Name', now: NOW2 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value[0].name).toBe('New Name');
    expect(result.value[0].updatedAt).toBe(NOW2);
  });

  it('trims whitespace from name', () => {
    const lists = [makeList('list-1')];
    const result = renameList(lists, { id: 'list-1', name: '  Trimmed  ', now: NOW });
    expect(result.kind === 'ok' && result.value[0].name).toBe('Trimmed');
  });

  it('returns INVALID_LIST_NAME for blank name', () => {
    const result = renameList([makeList('list-1')], { id: 'list-1', name: '   ', now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.INVALID_LIST_NAME });
  });

  it('returns NotFound for unknown id', () => {
    const result = renameList([], { id: 'no-such', name: 'X', now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingList', id: 'no-such' });
  });
});

// ── deleteList ────────────────────────────────────────────────────────────────

describe('deleteList', () => {
  it('deletes a non-default list', () => {
    const lists = [makeList('list-1'), makeList('list-2')];
    const config = makeConfig('list-1');
    const result = deleteList(lists, config, { id: 'list-2' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('list-1');
  });

  it('blocks deletion of the default list', () => {
    const lists = [makeList('list-1'), makeList('list-2')];
    const config = makeConfig('list-1');
    const result = deleteList(lists, config, { id: 'list-1' });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.LIST_IS_DEFAULT });
  });

  it('returns NotFound for unknown id', () => {
    const result = deleteList([], makeConfig('list-1'), { id: 'no-such' });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingList', id: 'no-such' });
  });
});

// ── setDefaultList ────────────────────────────────────────────────────────────

describe('setDefaultList', () => {
  it('updates defaultListId', () => {
    const lists = [makeList('list-1'), makeList('list-2')];
    const config = makeConfig('list-1');
    const result = setDefaultList(lists, config, { listId: 'list-2' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.defaultListId).toBe('list-2');
  });

  it('returns NotFound for unknown listId', () => {
    const result = setDefaultList([], makeConfig('list-1'), { listId: 'no-such' });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingList', id: 'no-such' });
  });
});

// ── addItem ───────────────────────────────────────────────────────────────────

describe('addItem', () => {
  it('appends item with pending matchState and null canonId', () => {
    const result = addItem(
      [],
      { rawText: 'heinz beans 4 tins', source: { kind: 'manual' }, now: NOW },
      makeIds(),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(1);
    const item = result.value[0];
    expect(item.rawText).toBe('heinz beans 4 tins');
    expect(item.matchState).toBe('pending');
    expect(item.canonId).toBeNull();
    expect(item.checked).toBe(false);
    expect(item.notes).toBe('');
    expect(item.sources).toEqual([{ kind: 'manual' }]);
  });

  it('trims whitespace from rawText', () => {
    const result = addItem(
      [],
      { rawText: '  milk 2L  ', source: { kind: 'manual' }, now: NOW },
      makeIds(),
    );
    expect(result.kind === 'ok' && result.value[0].rawText).toBe('milk 2L');
  });

  it('returns INVALID_ITEM_RAW_TEXT for blank rawText', () => {
    const result = addItem([], { rawText: '   ', source: { kind: 'manual' }, now: NOW }, makeIds());
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({
      kind: 'ValidationError',
      code: ErrorCode.INVALID_ITEM_RAW_TEXT,
    });
  });

  it('does not mutate the original items array', () => {
    const items: ShoppingListItem[] = [];
    addItem(items, { rawText: 'eggs', source: { kind: 'manual' }, now: NOW }, makeIds());
    expect(items).toHaveLength(0);
  });
});

// ── editItemRawText ───────────────────────────────────────────────────────────

describe('editItemRawText', () => {
  it('updates rawText, clears canonId and resets matchState to pending', () => {
    const items = [makeItem('item-1', { canonId: 'c1', matchState: 'matched' })];
    const result = editItemRawText(items, { id: 'item-1', rawText: 'oat milk 1L', now: NOW2 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value[0].rawText).toBe('oat milk 1L');
    expect(result.value[0].canonId).toBeNull();
    expect(result.value[0].matchState).toBe('pending');
    expect(result.value[0].updatedAt).toBe(NOW2);
  });

  it('trims whitespace', () => {
    const items = [makeItem('item-1')];
    const result = editItemRawText(items, { id: 'item-1', rawText: '  trimmed  ', now: NOW });
    expect(result.kind === 'ok' && result.value[0].rawText).toBe('trimmed');
  });

  it('returns INVALID_ITEM_RAW_TEXT for blank rawText', () => {
    const result = editItemRawText([makeItem('item-1')], { id: 'item-1', rawText: '', now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({
      kind: 'ValidationError',
      code: ErrorCode.INVALID_ITEM_RAW_TEXT,
    });
  });

  it('returns NotFound for unknown id', () => {
    const result = editItemRawText([], { id: 'no-such', rawText: 'x', now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingListItem', id: 'no-such' });
  });
});

// ── editItemNotes ─────────────────────────────────────────────────────────────

describe('editItemNotes', () => {
  it('updates notes and stamps updatedAt', () => {
    const items = [makeItem('item-1')];
    const result = editItemNotes(items, { id: 'item-1', notes: 'organic only', now: NOW2 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value[0].notes).toBe('organic only');
    expect(result.value[0].updatedAt).toBe(NOW2);
  });

  it('trims notes', () => {
    const items = [makeItem('item-1')];
    const result = editItemNotes(items, { id: 'item-1', notes: '  organic  ', now: NOW });
    expect(result.kind === 'ok' && result.value[0].notes).toBe('organic');
  });

  it('does not reset canonId or matchState', () => {
    const items = [makeItem('item-1', { canonId: 'c1', matchState: 'matched' })];
    const result = editItemNotes(items, { id: 'item-1', notes: 'note', now: NOW2 });
    expect(result.kind === 'ok' && result.value[0].canonId).toBe('c1');
    expect(result.kind === 'ok' && result.value[0].matchState).toBe('matched');
  });

  it('returns NotFound for unknown id', () => {
    const result = editItemNotes([], { id: 'no-such', notes: 'x', now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingListItem', id: 'no-such' });
  });
});

// ── checkItem ─────────────────────────────────────────────────────────────────

describe('checkItem', () => {
  it('sets checked to true', () => {
    const items = [makeItem('item-1', { checked: false })];
    const result = checkItem(items, { id: 'item-1', now: NOW2 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value[0].checked).toBe(true);
    expect(result.value[0].updatedAt).toBe(NOW2);
  });

  it('returns NotFound for unknown id', () => {
    const result = checkItem([], { id: 'no-such', now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingListItem', id: 'no-such' });
  });
});

// ── uncheckItem ───────────────────────────────────────────────────────────────

describe('uncheckItem', () => {
  it('sets checked to false', () => {
    const items = [makeItem('item-1', { checked: true })];
    const result = uncheckItem(items, { id: 'item-1', now: NOW2 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value[0].checked).toBe(false);
    expect(result.value[0].updatedAt).toBe(NOW2);
  });

  it('returns NotFound for unknown id', () => {
    const result = uncheckItem([], { id: 'no-such', now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingListItem', id: 'no-such' });
  });
});

// ── deleteItem ────────────────────────────────────────────────────────────────

describe('deleteItem', () => {
  it('removes the item', () => {
    const items = [makeItem('item-1'), makeItem('item-2')];
    const result = deleteItem(items, { id: 'item-1' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('item-2');
  });

  it('returns NotFound for unknown id', () => {
    const result = deleteItem([], { id: 'no-such' });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingListItem', id: 'no-such' });
  });
});

// ── clearCheckedItems ─────────────────────────────────────────────────────────

describe('clearCheckedItems', () => {
  it('removes all checked items', () => {
    const items = [
      makeItem('item-1', { checked: true }),
      makeItem('item-2', { checked: false }),
      makeItem('item-3', { checked: true }),
    ];
    const result = clearCheckedItems(items);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('item-2');
  });

  it('returns all items unchanged when none are checked', () => {
    const items = [makeItem('item-1'), makeItem('item-2')];
    const result = clearCheckedItems(items);
    expect(result.kind === 'ok' && result.value).toHaveLength(2);
  });
});

// ── moveItems ─────────────────────────────────────────────────────────────────

describe('moveItems', () => {
  it('moves items from source to target, resetting match state', () => {
    const sourceItems = [
      makeItem('item-1', { canonId: 'c1', matchState: 'matched' }),
      makeItem('item-2'),
    ];
    const targetItems = [makeItem('item-3')];
    const result = moveItems(sourceItems, targetItems, { itemIds: ['item-1'], now: NOW2 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.sourceItems).toHaveLength(1);
    expect(result.value.sourceItems[0].id).toBe('item-2');
    expect(result.value.targetItems).toHaveLength(2);
    const moved = result.value.targetItems.find((i) => i.id === 'item-1')!;
    expect(moved.canonId).toBeNull();
    expect(moved.matchState).toBe('pending');
    expect(moved.updatedAt).toBe(NOW2);
  });

  it('returns NotFound when any itemId is not in source', () => {
    const result = moveItems([], [], { itemIds: ['no-such'], now: NOW });
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'shoppingListItem', id: 'no-such' });
  });

  it('moves multiple items in one call', () => {
    const sourceItems = [makeItem('item-1'), makeItem('item-2'), makeItem('item-3')];
    const result = moveItems(sourceItems, [], { itemIds: ['item-1', 'item-3'], now: NOW });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.sourceItems).toHaveLength(1);
    expect(result.value.sourceItems[0].id).toBe('item-2');
    expect(result.value.targetItems).toHaveLength(2);
  });
});
