import { describe, it, expect } from 'vitest';
import { setCanonItemSynonyms } from '../../src/canon/commands/setCanonItemSynonyms.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function item(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'c1',
    schemaVersion: 2,
    name: 'Olive Oil',
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    ...overrides,
  };
}

describe('setCanonItemSynonyms', () => {
  it('sets synonyms on an item', () => {
    const result = setCanonItemSynonyms(item(), ['EVOO', 'liquid gold']);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO', 'liquid gold']);
  });

  it('trims whitespace from each synonym', () => {
    const result = setCanonItemSynonyms(item(), ['  EVOO  ', ' liquid gold ']);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO', 'liquid gold']);
  });

  it('removes empty strings after trimming', () => {
    const result = setCanonItemSynonyms(item(), ['EVOO', '   ', '']);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO']);
  });

  it('deduplicates synonyms', () => {
    const result = setCanonItemSynonyms(item(), ['EVOO', 'EVOO', 'liquid gold']);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO', 'liquid gold']);
  });

  it('accepts an empty array, clearing all synonyms', () => {
    const result = setCanonItemSynonyms(item({ synonyms: ['EVOO'] }), []);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual([]);
  });

  it('preserves all other fields', () => {
    const original = item({ name: 'Olive Oil', aisleId: 'oils' });
    const result = setCanonItemSynonyms(original, ['EVOO']);
    if (result.kind === 'ok') {
      expect(result.value.id).toBe(original.id);
      expect(result.value.name).toBe(original.name);
      expect(result.value.aisleId).toBe(original.aisleId);
    }
  });
});
