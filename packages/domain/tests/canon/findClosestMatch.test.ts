import { describe, it, expect } from 'vitest';
import { findClosestMatch } from '../../src/canon/queries/findClosestMatch.js';
import type { CanonItem } from '../../src/canon/index.js';

const items: readonly CanonItem[] = [
  { id: '1', name: 'Tomato', synonyms: ['tom', 'tomate'], aisle: 'produce' },
  { id: '2', name: 'Olive Oil', synonyms: ['EVOO'], aisle: 'oils' },
];

describe('findClosestMatch', () => {
  it('matches on canonical name (case-insensitive)', () => {
    expect(findClosestMatch(items, 'tomato')?.id).toBe('1');
    expect(findClosestMatch(items, '  TOMATO  ')?.id).toBe('1');
  });

  it('matches on synonym', () => {
    expect(findClosestMatch(items, 'tom')?.id).toBe('1');
    expect(findClosestMatch(items, 'evoo')?.id).toBe('2');
  });

  it('returns null when no match', () => {
    expect(findClosestMatch(items, 'butter')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(findClosestMatch(items, '   ')).toBeNull();
  });
});
