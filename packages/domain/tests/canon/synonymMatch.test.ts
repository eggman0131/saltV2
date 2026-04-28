import { describe, it, expect } from 'vitest';
import { synonymMatch } from '../../src/canon/queries/synonymMatch.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

const items: readonly CanonItem[] = [
  {
    id: '1',
    name: 'Tomato',
    synonyms: ['tom', 'tomate'],
    aisle: 'produce',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
  },
  {
    id: '2',
    name: 'Olive Oil',
    synonyms: ['EVOO'],
    aisle: 'oils',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
  },
  {
    id: '3',
    name: 'Butter',
    synonyms: [],
    aisle: 'dairy',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
  },
];

describe('synonymMatch', () => {
  it('returns item when normalised synonym matches', () => {
    const result = synonymMatch(items, 'tom');
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('is case-insensitive via normalisation', () => {
    const result = synonymMatch(items, 'evoo');
    expect(result.map((i) => i.id)).toEqual(['2']);
  });

  it('returns empty array when no synonym matches', () => {
    expect(synonymMatch(items, 'butter')).toHaveLength(0);
    expect(synonymMatch(items, 'unknown')).toHaveLength(0);
  });

  it('normalises synonyms before comparing', () => {
    // 'tomate' is a synonym → normaliseName('tomate') = 'tomate'
    const result = synonymMatch(items, 'tomate');
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('returns empty array for empty items list', () => {
    expect(synonymMatch([], 'tom')).toHaveLength(0);
  });

  it('returns empty array for empty target', () => {
    expect(synonymMatch(items, '')).toHaveLength(0);
  });
});
