import { describe, it, expect } from 'vitest';
import { createCanonLookup } from '../../src/canon/index.js';
import type { CanonItem, CanonStorePort } from '../../src/canon/index.js';

const items: readonly CanonItem[] = [
  { id: '1', name: 'Tomato', synonyms: ['tom'], aisle: 'produce' },
];

const store: CanonStorePort = {
  async save() {},
  async load() {
    return null;
  },
  async list() {
    return items;
  },
  async delete() {},
};

describe('createCanonLookup', () => {
  it('exposes a CanonLookupPort backed by the store', async () => {
    const lookup = createCanonLookup(store);
    expect(await lookup.findClosestMatch('tom')).toEqual(items[0]);
    expect(await lookup.findClosestMatch('butter')).toBeNull();
    expect(lookup.normaliseName('  TOMATO  ')).toBe('tomato');
  });
});
