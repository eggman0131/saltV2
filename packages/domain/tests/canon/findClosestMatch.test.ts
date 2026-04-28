import { describe, it, expect, vi } from 'vitest';
import { findClosestMatch } from '../../src/canon/queries/findClosestMatch.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function item(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    synonyms: [],
    aisle: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    ...overrides,
  };
}

const catalog: readonly CanonItem[] = [
  item({ id: '1', name: 'Tomato', synonyms: ['tom', 'tomate'] }),
  item({ id: '2', name: 'Olive Oil', synonyms: ['EVOO'] }),
  item({ id: '3', name: 'Butter', synonyms: [] }),
  item({ id: '4', name: 'Peanut Butter', synonyms: [] }),
];

describe('findClosestMatch — stage 1: exact normalised name match', () => {
  it('returns stage 1 match for exact name after normalisation', () => {
    const result = findClosestMatch(catalog, '  TOMATO  ');
    expect(result?.stage).toBe(1);
    expect(result?.item.id).toBe('1');
    expect(result?.confidence).toBe(1.0);
  });

  it('handles multi-word exact match', () => {
    const result = findClosestMatch(catalog, 'olive oil');
    expect(result?.stage).toBe(1);
    expect(result?.item.id).toBe('2');
  });

  it('handles plurals via singularization', () => {
    const result = findClosestMatch(catalog, 'tomatoes');
    expect(result?.stage).toBe(1);
    expect(result?.item.id).toBe('1');
  });
});

describe('findClosestMatch — stage 2: token overlap', () => {
  it('returns stage 2 match when token overlap meets threshold', () => {
    // 'peanut butter' has 2 tokens; 'peanut butter sauce' overlaps on 2 of 3 → 0.67 < 0.80
    // but 'peanut butter' vs 'peanut butter' is stage 1 (exact).
    // Test: a name that partially overlaps above threshold.
    // 'Butter' is 1 token; query 'Butter spread' → 1 overlap of 2 = 0.5 < threshold → falls through.
    // Better: add an item with 2 tokens, query with both tokens + extra.
    // 'Olive Oil' (2 tokens) vs 'olive' = 1/2 = 0.5 < 0.80.
    // 'Olive Oil' vs 'olive oil extra' = 2/3 ≈ 0.67 < 0.80.
    // Single-token exact: 'butter' → exact match at stage 1.
    // Let's use a unique name not in catalog:
    const items = [item({ id: 'x', name: 'Extra Virgin Olive Oil', synonyms: [] })];
    // 'extra virgin olive oil' vs 'olive oil' → 2 overlap of max(4,2)=4 → 0.5 < threshold
    const miss = findClosestMatch(items, 'olive oil');
    expect(miss?.stage).not.toBe(2);

    // 'extra virgin olive oil' vs 'extra virgin olive' → 3 overlap of max(4,3)=4 → 0.75 < 0.80
    const near = findClosestMatch(items, 'extra virgin olive');
    expect(near?.stage).not.toBe(2);

    // 'extra virgin olive oil' vs 'extra virgin olive oil sauce' = 4/5 = 0.80 >= threshold
    const hit = findClosestMatch(
      [item({ id: 'x', name: 'Extra Virgin Olive Oil Sauce', synonyms: [] })],
      'extra virgin olive oil',
    );
    expect(hit?.stage).toBe(2);
    expect(hit?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('does not proceed beyond stage 2 when threshold met', () => {
    // If stage 2 fires, the item should not be in stage 3 or 4.
    const items = [item({ id: 'x', name: 'Extra Virgin Olive Oil Sauce', synonyms: ['evoos'] })];
    const result = findClosestMatch(items, 'extra virgin olive oil');
    expect(result?.stage).toBe(2); // must not fall through to stage 3 (synonym)
  });
});

describe('findClosestMatch — stage 3: synonym match', () => {
  it('returns stage 3 for exact synonym hit', () => {
    const result = findClosestMatch(catalog, 'tom');
    expect(result?.stage).toBe(3);
    expect(result?.item.id).toBe('1');
    expect(result?.confidence).toBe(1.0);
  });

  it('is case-insensitive for synonyms', () => {
    const result = findClosestMatch(catalog, 'evoo');
    expect(result?.stage).toBe(3);
    expect(result?.item.id).toBe('2');
  });

  it('matches synonym plurals via singularization', () => {
    // synonym 'tom' normalises to 'tom'; 'toms' normalises to 'tom' → should match
    const result = findClosestMatch(catalog, 'toms');
    expect(result?.stage).toBe(3);
    expect(result?.item.id).toBe('1');
  });
});

describe('findClosestMatch — stage 4: string similarity', () => {
  it('returns stage 4 for a near-match above threshold', () => {
    // 'tomatoe' → distance 1 from 'tomato', score ~0.857 >= 0.85
    const result = findClosestMatch(catalog, 'tomatoe');
    expect(result?.stage).toBe(4);
    expect(result?.item.id).toBe('1');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

describe('findClosestMatch — no match', () => {
  it('returns null for an unrelated query', () => {
    expect(findClosestMatch(catalog, 'chia seeds')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(findClosestMatch(catalog, '   ')).toBeNull();
    expect(findClosestMatch(catalog, '')).toBeNull();
  });

  it('returns null for empty catalog', () => {
    expect(findClosestMatch([], 'tomato')).toBeNull();
  });
});
