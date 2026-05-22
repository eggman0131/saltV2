import { describe, it, expect } from 'vitest';
import { combineItemsByUnit } from '@salt/domain';
import type { ShoppingListItem } from '@salt/domain';

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

// ── same-unit sum ─────────────────────────────────────────────────────────────

describe('combineItemsByUnit — same-unit sum', () => {
  it('sums amounts for entries sharing the same unit', () => {
    const items = [
      makeItem('i1', { amount: 2, unit: 'kg' }),
      makeItem('i2', { amount: 1.5, unit: 'kg' }),
    ];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.unit).toBe('kg');
    expect(slots[0]!.combinedAmount).toBe(3.5);
    expect(slots[0]!.entries).toHaveLength(2);
  });

  it('normalises unit case and whitespace before grouping', () => {
    const items = [
      makeItem('i1', { amount: 1, unit: 'Kg' }),
      makeItem('i2', { amount: 2, unit: ' kg ' }),
    ];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.combinedAmount).toBe(3);
    expect(slots[0]!.entries).toHaveLength(2);
  });

  it('exposes all individual entries in the slot', () => {
    const items = [
      makeItem('i1', { amount: 1, unit: 'kg', rawText: '1kg flour' }),
      makeItem('i2', { amount: 2, unit: 'kg', rawText: '2kg flour' }),
      makeItem('i3', { amount: 0.5, unit: 'kg', rawText: '500g flour' }),
    ];
    const slots = combineItemsByUnit(items);
    expect(slots[0]!.entries.map((e) => e.id)).toEqual(['i1', 'i2', 'i3']);
  });
});

// ── no-unit count sum ─────────────────────────────────────────────────────────

describe('combineItemsByUnit — no-unit count sum', () => {
  it('sums plain-count amounts for entries with no unit', () => {
    const items = [
      makeItem('i1', { amount: 3, rawText: '3 onions' }),
      makeItem('i2', { amount: 2, rawText: '2 onions' }),
    ];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.unit).toBeUndefined();
    expect(slots[0]!.combinedAmount).toBe(5);
    expect(slots[0]!.entries).toHaveLength(2);
  });
});

// ── mixed-unit grouping ───────────────────────────────────────────────────────

describe('combineItemsByUnit — mixed-unit grouping', () => {
  it('creates separate slots for different units', () => {
    const items = [
      makeItem('i1', { amount: 2, unit: 'kg' }),
      makeItem('i2', { amount: 500, unit: 'g' }),
    ];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(2);
    const kgSlot = slots.find((s) => s.unit === 'kg')!;
    const gSlot = slots.find((s) => s.unit === 'g')!;
    expect(kgSlot.combinedAmount).toBe(2);
    expect(kgSlot.entries).toHaveLength(1);
    expect(gSlot.combinedAmount).toBe(500);
    expect(gSlot.entries).toHaveLength(1);
  });

  it('does not sum across different units even if they appear adjacent', () => {
    const items = [
      makeItem('i1', { amount: 1, unit: 'kg' }),
      makeItem('i2', { amount: 1, unit: 'kg' }),
      makeItem('i3', { amount: 500, unit: 'g' }),
    ];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(2);
    const kgSlot = slots.find((s) => s.unit === 'kg')!;
    expect(kgSlot.combinedAmount).toBe(2);
  });

  it('keeps no-unit entries separate from unit entries', () => {
    const items = [makeItem('i1', { amount: 3 }), makeItem('i2', { amount: 2, unit: 'kg' })];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(2);
    const noUnitSlot = slots.find((s) => s.unit === undefined)!;
    const kgSlot = slots.find((s) => s.unit === 'kg')!;
    expect(noUnitSlot.combinedAmount).toBe(3);
    expect(kgSlot.combinedAmount).toBe(2);
  });
});

// ── unparsed-amount entries ───────────────────────────────────────────────────

describe('combineItemsByUnit — unparsed-amount entries', () => {
  it('gives undefined combinedAmount when no entry has an amount', () => {
    const items = [makeItem('i1', { rawText: 'a couple of onions' })];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.unit).toBeUndefined();
    expect(slots[0]!.combinedAmount).toBeUndefined();
    expect(slots[0]!.entries).toHaveLength(1);
  });

  it('groups a parsed-amount entry with an unparsed entry in the same no-unit slot', () => {
    const items = [
      makeItem('i1', { amount: 3, rawText: '3 onions' }),
      makeItem('i2', { rawText: 'a couple of onions' }),
    ];
    const slots = combineItemsByUnit(items);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.unit).toBeUndefined();
    expect(slots[0]!.entries).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(combineItemsByUnit([])).toHaveLength(0);
  });
});
