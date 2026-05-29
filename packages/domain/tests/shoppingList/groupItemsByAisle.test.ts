import { describe, it, expect } from 'vitest';
import { groupItemsByAisle } from '@salt/domain';
import type { ShoppingListItem } from '@salt/domain';
import type { CanonInfo, AisleInfo } from '../../src/shoppingList/queries/groupItemsByAisle.js';

const NOW = '2026-01-01T00:00:00.000Z';

function makeItem(id: string, overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id,
    rawText: 'test item',
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

function makeCanonMap(entries: CanonInfo[]): ReadonlyMap<string, CanonInfo> {
  return new Map(entries.map((c) => [c.id, c]));
}

const AISLES: AisleInfo[] = [
  { id: 'aisle-1', name: 'Produce', order: 0 },
  { id: 'aisle-2', name: 'Dairy', order: 1 },
  { id: 'aisle-3', name: 'Bakery', order: 2 },
];

describe('groupItemsByAisle — Other bucket routing', () => {
  it('routes pending items to Other with isPending=true', () => {
    const items = [makeItem('i1', { matchState: 'pending' })];
    const result = groupItemsByAisle(items, makeCanonMap([]), AISLES);
    expect(result.other.contributors).toHaveLength(1);
    expect(result.other.contributors[0].isPending).toBe(true);
    expect(result.aisles).toHaveLength(0);
  });

  it('routes failed items to Other with isPending=false', () => {
    const items = [makeItem('i1', { matchState: 'failed' })];
    const result = groupItemsByAisle(items, makeCanonMap([]), AISLES);
    expect(result.other.contributors).toHaveLength(1);
    expect(result.other.contributors[0].isPending).toBe(false);
  });

  it('routes needs_approval items with a valid aisle to the aisle (treated as matched)', () => {
    const items = [makeItem('i1', { matchState: 'needs_approval', canonId: 'c1' })];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Beans', aisleId: 'aisle-1' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.other.contributors).toHaveLength(0);
    expect(result.aisles[0].items).toHaveLength(1);
  });

  it('routes needs_approval items with null aisleId to Other', () => {
    const items = [makeItem('i1', { matchState: 'needs_approval', canonId: 'c1' })];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Beans', aisleId: null }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.other.contributors).toHaveLength(1);
  });

  it('routes stale-canon items (canonId not in map) to Other', () => {
    const items = [makeItem('i1', { matchState: 'matched', canonId: 'deleted-canon' })];
    const result = groupItemsByAisle(items, makeCanonMap([]), AISLES);
    expect(result.other.contributors).toHaveLength(1);
    expect(result.other.contributors[0].isPending).toBe(false);
  });

  it('routes matched items with null aisleId to Other', () => {
    const items = [makeItem('i1', { matchState: 'matched', canonId: 'c1' })];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Beans', aisleId: null }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.other.contributors).toHaveLength(1);
  });
});

describe('groupItemsByAisle — aisle ordering', () => {
  it('places matched items in the correct aisle in canon order', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c-dairy' }),
      makeItem('i2', { matchState: 'matched', canonId: 'c-produce' }),
    ];
    const canonMap = makeCanonMap([
      { id: 'c-dairy', name: 'Milk', aisleId: 'aisle-2' },
      { id: 'c-produce', name: 'Apples', aisleId: 'aisle-1' },
    ]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles).toHaveLength(2);
    expect(result.aisles[0].aisleId).toBe('aisle-1');
    expect(result.aisles[1].aisleId).toBe('aisle-2');
  });

  it('omits aisles with no matching items', () => {
    const items = [makeItem('i1', { matchState: 'matched', canonId: 'c1' })];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Milk', aisleId: 'aisle-2' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles).toHaveLength(1);
    expect(result.aisles[0].aisleId).toBe('aisle-2');
  });
});

describe('groupItemsByAisle — items within an aisle', () => {
  it('keeps duplicate-canon items as separate rows (no collapsing)', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c1', rawText: 'heinz beans 4 tins' }),
      makeItem('i2', { matchState: 'matched', canonId: 'c1', rawText: 'baked beans 2 tins' }),
    ];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Baked Beans', aisleId: 'aisle-1' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].items).toHaveLength(2);
    expect(result.aisles[0].items.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('sorts items within an aisle by createdAt ascending (oldest first)', () => {
    const items = [
      makeItem('i1', {
        matchState: 'matched',
        canonId: 'c1',
        createdAt: '2026-01-01T12:00:00.000Z',
      }),
      makeItem('i2', {
        matchState: 'matched',
        canonId: 'c2',
        createdAt: '2026-01-01T10:00:00.000Z',
      }),
      makeItem('i3', {
        matchState: 'matched',
        canonId: 'c1',
        createdAt: '2026-01-01T11:00:00.000Z',
      }),
    ];
    const canonMap = makeCanonMap([
      { id: 'c1', name: 'Beans', aisleId: 'aisle-1' },
      { id: 'c2', name: 'Apples', aisleId: 'aisle-1' },
    ]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].items.map((i) => i.id)).toEqual(['i2', 'i3', 'i1']);
  });
});

describe('groupItemsByAisle — checked bucket', () => {
  it('routes checked items to the checked bucket regardless of match state', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c1', checked: true }),
      makeItem('i2', { matchState: 'pending', checked: true }),
      makeItem('i3', { matchState: 'matched', canonId: 'c1', checked: false }),
    ];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Milk', aisleId: 'aisle-2' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.checked.contributors).toHaveLength(2);
    expect(result.aisles[0].items).toHaveLength(1);
    expect(result.other.contributors).toHaveLength(0);
  });

  it('sorts checked items most-recently-updated first', () => {
    const items = [
      makeItem('i1', { checked: true, updatedAt: '2026-01-01T10:00:00.000Z' }),
      makeItem('i2', { checked: true, updatedAt: '2026-01-01T12:00:00.000Z' }),
      makeItem('i3', { checked: true, updatedAt: '2026-01-01T11:00:00.000Z' }),
    ];
    const result = groupItemsByAisle(items, makeCanonMap([]), AISLES);
    const ids = result.checked.contributors.map((i) => i.id);
    expect(ids).toEqual(['i2', 'i3', 'i1']);
  });

  it('returns empty buckets for an empty input', () => {
    const result = groupItemsByAisle([], makeCanonMap([]), AISLES);
    expect(result.aisles).toHaveLength(0);
    expect(result.other.contributors).toHaveLength(0);
    expect(result.checked.contributors).toHaveLength(0);
  });
});
