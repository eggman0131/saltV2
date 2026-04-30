import { describe, it, expect } from 'vitest';
import { renameCanonItem } from '../../src/canon/commands/renameCanonItem.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function item(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'c1',
    name: 'Olive Oil',
    synonyms: [],
    aisleId: 'oils',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    ...overrides,
  };
}

describe('renameCanonItem', () => {
  it('returns an item with the trimmed new name', () => {
    const result = renameCanonItem(item(), '  Extra Virgin Olive Oil  ');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.name).toBe('Extra Virgin Olive Oil');
  });

  it('preserves all other fields', () => {
    const original = item({ synonyms: ['EVOO'], aisleId: 'oils' });
    const result = renameCanonItem(original, 'New Name');
    if (result.kind === 'ok') {
      expect(result.value.id).toBe(original.id);
      expect(result.value.synonyms).toEqual(original.synonyms);
      expect(result.value.aisleId).toBe(original.aisleId);
    }
  });

  it('returns ValidationError for an empty name', () => {
    const result = renameCanonItem(item(), '   ');
    expect(result.kind).toBe('err');
    if (result.kind === 'err') {
      expect(result.error.kind).toBe('ValidationError');
    }
  });

  it('returns ValidationError for an empty string', () => {
    const result = renameCanonItem(item(), '');
    expect(result.kind).toBe('err');
  });
});
