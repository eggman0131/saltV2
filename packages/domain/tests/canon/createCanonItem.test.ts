import { describe, it, expect } from 'vitest';
import { createCanonItem } from '../../src/canon/index.js';

describe('createCanonItem', () => {
  it('builds a CanonItem with trimmed name', () => {
    const item = createCanonItem({ id: 'c1', name: '  Tomato  ' });
    expect(item).toEqual({ id: 'c1', name: 'Tomato', synonyms: [], aisle: null });
  });

  it('trims and drops empty synonyms', () => {
    const item = createCanonItem({
      id: 'c2',
      name: 'Tomato',
      synonyms: [' tom ', '', '   ', 'tomate'],
    });
    expect(item.synonyms).toEqual(['tom', 'tomate']);
  });

  it('preserves aisle when supplied', () => {
    const item = createCanonItem({ id: 'c3', name: 'Tomato', aisle: 'produce' });
    expect(item.aisle).toBe('produce');
  });

  it('throws INVALID_CANON_NAME when name is blank', () => {
    expect(() => createCanonItem({ id: 'c4', name: '   ' })).toThrow('INVALID_CANON_NAME');
  });

  it('throws INVALID_CANON_NAME when name is empty', () => {
    expect(() => createCanonItem({ id: 'c5', name: '' })).toThrow('INVALID_CANON_NAME');
  });
});
