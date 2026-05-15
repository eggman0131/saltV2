import { describe, it, expect } from 'vitest';
import { groupItemsByAisle } from '@salt/domain';
import type { ShoppingListItem, CanonInfo, AisleInfo } from '@salt/domain';

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── Other bucket routing ──────────────────────────────────────────────────────

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

  it('routes needs_approval items with a valid aisle to the aisle group (treated as matched)', () => {
    const items = [makeItem('i1', { matchState: 'needs_approval', canonId: 'c1' })];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Beans', aisleId: 'aisle-1' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.other.contributors).toHaveLength(0);
    expect(result.aisles[0].groups[0].contributors).toHaveLength(1);
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

  it('hides Other (empty contributors) when all items are matched to aisles', () => {
    const items = [makeItem('i1', { matchState: 'matched', canonId: 'c1' })];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Milk', aisleId: 'aisle-2' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.other.contributors).toHaveLength(0);
    expect(result.aisles).toHaveLength(1);
  });
});

// ── Aisle grouping ────────────────────────────────────────────────────────────

describe('groupItemsByAisle — aisle grouping', () => {
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
    expect(result.aisles[0].aisleId).toBe('aisle-1'); // Produce (order 0) first
    expect(result.aisles[1].aisleId).toBe('aisle-2'); // Dairy (order 1) second
  });

  it('omits aisles with no matching items', () => {
    const items = [makeItem('i1', { matchState: 'matched', canonId: 'c1' })];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Milk', aisleId: 'aisle-2' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles).toHaveLength(1);
    expect(result.aisles[0].aisleId).toBe('aisle-2');
  });
});

// ── collapse-by-canonId ───────────────────────────────────────────────────────

describe('groupItemsByAisle — collapse by canonId', () => {
  it('collapses multiple items with the same canonId into one group', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c1', rawText: 'heinz beans 4 tins' }),
      makeItem('i2', { matchState: 'matched', canonId: 'c1', rawText: 'baked beans 2 tins' }),
    ];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Baked Beans', aisleId: 'aisle-1' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].groups).toHaveLength(1);
    expect(result.aisles[0].groups[0].canonName).toBe('Baked Beans');
    expect(result.aisles[0].groups[0].contributors).toHaveLength(2);
  });

  it('keeps separate canonIds as separate groups, sorted alphabetically', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c-z' }),
      makeItem('i2', { matchState: 'matched', canonId: 'c-a' }),
    ];
    const canonMap = makeCanonMap([
      { id: 'c-z', name: 'Zucchini', aisleId: 'aisle-1' },
      { id: 'c-a', name: 'Apples', aisleId: 'aisle-1' },
    ]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].groups[0].canonName).toBe('Apples');
    expect(result.aisles[0].groups[1].canonName).toBe('Zucchini');
  });
});

// ── check-all-then-drop-to-bottom ─────────────────────────────────────────────

describe('groupItemsByAisle — checked groups drop to bottom', () => {
  it('fully-checked group drops to bottom of aisle, partial group stays at top', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c-checked', checked: true }),
      makeItem('i2', { matchState: 'matched', canonId: 'c-partial', checked: false }),
      makeItem('i3', { matchState: 'matched', canonId: 'c-partial', checked: true }),
    ];
    const canonMap = makeCanonMap([
      { id: 'c-checked', name: 'Beans', aisleId: 'aisle-1' },
      { id: 'c-partial', name: 'Apples', aisleId: 'aisle-1' },
    ]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    const groups = result.aisles[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].canonName).toBe('Apples'); // partial group first
    expect(groups[0].allChecked).toBe(false);
    expect(groups[1].canonName).toBe('Beans'); // fully-checked group last
    expect(groups[1].allChecked).toBe(true);
  });

  it('allChecked is true only when every contributor is checked', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c1', checked: true }),
      makeItem('i2', { matchState: 'matched', canonId: 'c1', checked: true }),
    ];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Milk', aisleId: 'aisle-2' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].groups[0].allChecked).toBe(true);
  });

  it('unchecked contributors appear before checked contributors within a group', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c1', rawText: 'a', checked: true }),
      makeItem('i2', { matchState: 'matched', canonId: 'c1', rawText: 'b', checked: false }),
    ];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Milk', aisleId: 'aisle-2' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    const contributors = result.aisles[0].groups[0].contributors;
    expect(contributors[0].checked).toBe(false);
    expect(contributors[1].checked).toBe(true);
  });

  it('returns empty aisles array when no items are matched to aisles', () => {
    const result = groupItemsByAisle([], makeCanonMap([]), AISLES);
    expect(result.aisles).toHaveLength(0);
    expect(result.other.contributors).toHaveLength(0);
  });
});
