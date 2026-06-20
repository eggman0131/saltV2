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
    needsCheck: false,
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
    expect(result.aisles[0].rows).toHaveLength(1);
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
  it('keeps duplicate-canon manual items as separate single rows (no collapsing)', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c1', rawText: 'heinz beans 4 tins' }),
      makeItem('i2', { matchState: 'matched', canonId: 'c1', rawText: 'baked beans 2 tins' }),
    ];
    const canonMap = makeCanonMap([{ id: 'c1', name: 'Baked Beans', aisleId: 'aisle-1' }]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows).toHaveLength(2);
    expect(result.aisles[0].rows.every((r) => !r.combined)).toBe(true);
    expect(result.aisles[0].rows.map((r) => r.key)).toEqual(['i1', 'i2']);
  });

  it('sorts rows within an aisle alphabetically by matched canon name', () => {
    const items = [
      makeItem('i1', { matchState: 'matched', canonId: 'c-beans' }),
      makeItem('i2', { matchState: 'matched', canonId: 'c-apples' }),
      makeItem('i3', { matchState: 'matched', canonId: 'c-carrots' }),
    ];
    const canonMap = makeCanonMap([
      { id: 'c-beans', name: 'Beans', aisleId: 'aisle-1' },
      { id: 'c-apples', name: 'Apples', aisleId: 'aisle-1' },
      { id: 'c-carrots', name: 'Carrots', aisleId: 'aisle-1' },
    ]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows.map((r) => r.key)).toEqual(['i2', 'i1', 'i3']);
  });

  it('clusters rows matched to the same canon together, breaking ties by createdAt', () => {
    const items = [
      makeItem('i1', {
        matchState: 'matched',
        canonId: 'c-onions',
        rawText: 'red onions',
        createdAt: '2026-01-01T12:00:00.000Z',
      }),
      makeItem('i2', {
        matchState: 'matched',
        canonId: 'c-apples',
        rawText: 'granny smith',
        createdAt: '2026-01-01T10:00:00.000Z',
      }),
      makeItem('i3', {
        matchState: 'matched',
        canonId: 'c-onions',
        rawText: 'brown onions',
        createdAt: '2026-01-01T11:00:00.000Z',
      }),
    ];
    const canonMap = makeCanonMap([
      { id: 'c-onions', name: 'Onions', aisleId: 'aisle-1' },
      { id: 'c-apples', name: 'Apples', aisleId: 'aisle-1' },
    ]);
    const result = groupItemsByAisle(items, canonMap, AISLES);
    // Apples first (A < O); the two (manual) Onions rows cluster, oldest (i3) before i1.
    expect(result.aisles[0].rows.map((r) => r.key)).toEqual(['i2', 'i3', 'i1']);
  });
});

describe('groupItemsByAisle — combining recipe rows (#184)', () => {
  const recipeSource = (recipeId: string) => ({
    kind: 'recipe' as const,
    recipeId,
    servings: 2,
    label: recipeId,
  });
  const canonMap = makeCanonMap([{ id: 'c-onion', name: 'Onions', aisleId: 'aisle-1' }]);

  it('combines recipe-sourced items resolving to the same canon into one row', () => {
    const items = [
      makeItem('r1', {
        matchState: 'matched',
        canonId: 'c-onion',
        sources: [recipeSource('soup')],
        amount: 2,
        unit: 'g',
      }),
      makeItem('r2', {
        matchState: 'matched',
        canonId: 'c-onion',
        sources: [recipeSource('stew')],
        amount: 3,
        unit: 'g',
      }),
    ];
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows).toHaveLength(1);
    const row = result.aisles[0].rows[0];
    expect(row.combined).toBe(true);
    expect(row.key).toBe('canon:c-onion');
    expect(row.contributors).toHaveLength(2);
    expect(row.subtotals).toEqual([{ unit: 'g', amount: 5 }]);
  });

  it('never combines manual items, even with the same canon', () => {
    const items = [
      makeItem('m1', { matchState: 'matched', canonId: 'c-onion' }),
      makeItem('m2', { matchState: 'matched', canonId: 'c-onion' }),
    ];
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows).toHaveLength(2);
    expect(result.aisles[0].rows.every((r) => !r.combined)).toBe(true);
  });

  it('keeps a manual item separate from a combined recipe row of the same canon', () => {
    const items = [
      makeItem('m1', { matchState: 'matched', canonId: 'c-onion' }),
      makeItem('r1', { matchState: 'matched', canonId: 'c-onion', sources: [recipeSource('a')] }),
      makeItem('r2', { matchState: 'matched', canonId: 'c-onion', sources: [recipeSource('b')] }),
    ];
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows).toHaveLength(2);
    const combined = result.aisles[0].rows.find((r) => r.combined);
    const single = result.aisles[0].rows.find((r) => !r.combined);
    expect(combined?.contributors.map((c) => c.id).sort()).toEqual(['r1', 'r2']);
    expect(single?.key).toBe('m1');
  });

  it('a lone recipe item is a single (not combined) row', () => {
    const items = [
      makeItem('r1', { matchState: 'matched', canonId: 'c-onion', sources: [recipeSource('a')] }),
    ];
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows[0].combined).toBe(false);
    expect(result.aisles[0].rows[0].key).toBe('r1');
  });

  it('aggregates recipe-sourced metric (g) contributions of the same canon into one summed row', () => {
    // End-to-end win: now that recipe ingredients carry metric weights, two
    // recipe contributions of the same canon (150g + 300g carrots) collapse into
    // a single aisle row whose g subtotal sums to 450.
    const canonCarrots = makeCanonMap([{ id: 'c-carrot', name: 'Carrots', aisleId: 'aisle-1' }]);
    const items = [
      makeItem('r1', {
        matchState: 'matched',
        canonId: 'c-carrot',
        sources: [recipeSource('soup')],
        amount: 150,
        unit: 'g',
      }),
      makeItem('r2', {
        matchState: 'matched',
        canonId: 'c-carrot',
        sources: [recipeSource('stew')],
        amount: 300,
        unit: 'g',
      }),
    ];
    const result = groupItemsByAisle(items, canonCarrots, AISLES);
    expect(result.aisles[0].rows).toHaveLength(1);
    const row = result.aisles[0].rows[0];
    expect(row.combined).toBe(true);
    expect(row.contributors).toHaveLength(2);
    expect(row.subtotals).toEqual([{ unit: 'g', amount: 450 }]);
  });

  it('sums per unit and lists mixed units separately', () => {
    const items = [
      makeItem('r1', {
        matchState: 'matched',
        canonId: 'c-onion',
        sources: [recipeSource('a')],
        amount: 200,
        unit: 'g',
      }),
      makeItem('r2', {
        matchState: 'matched',
        canonId: 'c-onion',
        sources: [recipeSource('b')],
        amount: 2,
      }),
    ];
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows[0].subtotals).toEqual([
      { unit: 'g', amount: 200 },
      { unit: null, amount: 2 },
    ]);
  });

  it('flags the combined row for check if any contributor needs checking', () => {
    const items = [
      makeItem('r1', { matchState: 'matched', canonId: 'c-onion', sources: [recipeSource('a')] }),
      makeItem('r2', {
        matchState: 'matched',
        canonId: 'c-onion',
        sources: [recipeSource('b')],
        needsCheck: true,
      }),
    ];
    const result = groupItemsByAisle(items, canonMap, AISLES);
    expect(result.aisles[0].rows[0].needsCheck).toBe(true);
  });

  it('does not combine when combine:false (selection mode)', () => {
    const items = [
      makeItem('r1', { matchState: 'matched', canonId: 'c-onion', sources: [recipeSource('a')] }),
      makeItem('r2', { matchState: 'matched', canonId: 'c-onion', sources: [recipeSource('b')] }),
    ];
    const result = groupItemsByAisle(items, canonMap, AISLES, { combine: false });
    expect(result.aisles[0].rows).toHaveLength(2);
    expect(result.aisles[0].rows.every((r) => !r.combined)).toBe(true);
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
    expect(result.aisles[0].rows).toHaveLength(1);
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
