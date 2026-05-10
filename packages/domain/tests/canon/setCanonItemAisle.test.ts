import { describe, it, expect } from 'vitest';
import { setCanonItemAisle } from '../../src/canon/commands/setCanonItemAisle.js';
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
    deletedAt: null,
    ...overrides,
  };
}

describe('setCanonItemAisle', () => {
  it('assigns an aisle to an item with no aisle', () => {
    const result = setCanonItemAisle(item(), 'oils');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.aisleId).toBe('oils');
  });

  it('replaces an existing aisle', () => {
    const result = setCanonItemAisle(item({ aisleId: 'oils' }), 'produce');
    if (result.kind === 'ok') expect(result.value.aisleId).toBe('produce');
  });

  it('clears the aisle when passed null', () => {
    const result = setCanonItemAisle(item({ aisleId: 'oils' }), null);
    if (result.kind === 'ok') expect(result.value.aisleId).toBeNull();
  });

  it('preserves all other fields', () => {
    const original = item({ synonyms: ['EVOO'], name: 'Olive Oil' });
    const result = setCanonItemAisle(original, 'oils');
    if (result.kind === 'ok') {
      expect(result.value.id).toBe(original.id);
      expect(result.value.name).toBe(original.name);
      expect(result.value.synonyms).toEqual(original.synonyms);
    }
  });
});
