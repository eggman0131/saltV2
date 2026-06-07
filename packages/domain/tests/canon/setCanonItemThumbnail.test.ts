import { describe, it, expect } from 'vitest';
import { setCanonItemThumbnail } from '../../src/canon/commands/setCanonItemThumbnail.js';
import { CANON_ICON_HIDDEN } from '../../src/canon/queries/canonIcon.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function item(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'c1',
    schemaVersion: 5,
    name: 'Milk',
    synonyms: [],
    aisleId: null,
    thumbnail: 'https://example.com/old.webp',
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    ...overrides,
  };
}

describe('setCanonItemThumbnail', () => {
  it('sets a URL thumbnail', () => {
    const result = setCanonItemThumbnail(item(), 'https://example.com/new.webp');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.thumbnail).toBe('https://example.com/new.webp');
  });

  it('hides the icon with the hidden sentinel', () => {
    const result = setCanonItemThumbnail(item(), CANON_ICON_HIDDEN);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.thumbnail).toBe('hidden');
  });

  it('clears the icon with null (regenerate / unhide)', () => {
    const result = setCanonItemThumbnail(item({ thumbnail: 'hidden' }), null);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.thumbnail).toBeNull();
  });

  it('does not mutate the input', () => {
    const original = item();
    setCanonItemThumbnail(original, null);
    expect(original.thumbnail).toBe('https://example.com/old.webp');
  });

  it('preserves all other fields', () => {
    const original = item({ name: 'Cheddar', synonyms: ['cheese'] });
    const result = setCanonItemThumbnail(original, null);
    if (result.kind === 'ok') {
      expect(result.value.name).toBe('Cheddar');
      expect(result.value.synonyms).toEqual(['cheese']);
    }
  });
});
