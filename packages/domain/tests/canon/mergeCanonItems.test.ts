import { describe, it, expect } from 'vitest';
import { mergeCanonItems } from '@salt/domain';
import type { CanonItem } from '@salt/domain';

function item(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'item-1',
    schemaVersion: 2,
    name: 'Tomato',
    synonyms: [],
    aisleId: 'produce',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    deletedAt: null,
    ...overrides,
  };
}

describe('mergeCanonItems', () => {
  describe('id', () => {
    it('keeps local id', () => {
      const result = mergeCanonItems(item({ id: 'local-1' }), item({ id: 'remote-1' }));
      expect(result.id).toBe('local-1');
    });
  });

  describe('name', () => {
    it('takes remote name', () => {
      const result = mergeCanonItems(item({ name: 'Tomato' }), item({ name: 'Pomodoro' }));
      expect(result.name).toBe('Pomodoro');
    });

    it('keeps remote name when both match', () => {
      const result = mergeCanonItems(item({ name: 'Tomato' }), item({ name: 'Tomato' }));
      expect(result.name).toBe('Tomato');
    });
  });

  describe('synonyms', () => {
    it('unions synonyms from both sides', () => {
      const result = mergeCanonItems(
        item({ synonyms: ['tom', 'tomate'] }),
        item({ synonyms: ['pomodoro', 'tomate'] }),
      );
      expect(result.synonyms).toEqual(['tom', 'tomate', 'pomodoro']);
    });

    it('deduplicates case-insensitively, preserving local casing', () => {
      const result = mergeCanonItems(
        item({ synonyms: ['Tomato'] }),
        item({ synonyms: ['tomato', 'TOMATO'] }),
      );
      expect(result.synonyms).toEqual(['Tomato']);
    });

    it('appends remote-only synonyms', () => {
      const result = mergeCanonItems(
        item({ synonyms: [] }),
        item({ synonyms: ['tomate', 'pomodoro'] }),
      );
      expect(result.synonyms).toEqual(['tomate', 'pomodoro']);
    });

    it('returns empty when both sides have no synonyms', () => {
      const result = mergeCanonItems(item({ synonyms: [] }), item({ synonyms: [] }));
      expect(result.synonyms).toEqual([]);
    });
  });

  describe('aisleId', () => {
    it('takes remote aisleId', () => {
      const result = mergeCanonItems(item({ aisleId: 'dairy' }), item({ aisleId: 'produce' }));
      expect(result.aisleId).toBe('produce');
    });

    it('uses null from remote when remote has no aisleId', () => {
      const result = mergeCanonItems(item({ aisleId: 'dairy' }), item({ aisleId: null }));
      expect(result.aisleId).toBeNull();
    });
  });

  describe('thumbnail', () => {
    it('takes remote thumbnail', () => {
      const result = mergeCanonItems(
        item({ thumbnail: 'local.png' }),
        item({ thumbnail: 'remote.png' }),
      );
      expect(result.thumbnail).toBe('remote.png');
    });

    it('uses null from remote when remote has no thumbnail', () => {
      const result = mergeCanonItems(item({ thumbnail: 'local.png' }), item({ thumbnail: null }));
      expect(result.thumbnail).toBeNull();
    });
  });

  describe('embedding', () => {
    it('takes remote embedding', () => {
      const result = mergeCanonItems(
        item({ embedding: [0.1, 0.2] }),
        item({ embedding: [0.3, 0.4] }),
      );
      expect(result.embedding).toEqual([0.3, 0.4]);
    });

    it('uses null from remote when remote has no embedding', () => {
      const result = mergeCanonItems(item({ embedding: [0.1, 0.2] }), item({ embedding: null }));
      expect(result.embedding).toBeNull();
    });
  });

  describe('needs_approval', () => {
    it('false | false → false', () => {
      const result = mergeCanonItems(
        item({ needs_approval: false }),
        item({ needs_approval: false }),
      );
      expect(result.needs_approval).toBe(false);
    });

    it('true | false → true', () => {
      const result = mergeCanonItems(
        item({ needs_approval: true }),
        item({ needs_approval: false }),
      );
      expect(result.needs_approval).toBe(true);
    });

    it('false | true → true', () => {
      const result = mergeCanonItems(
        item({ needs_approval: false }),
        item({ needs_approval: true }),
      );
      expect(result.needs_approval).toBe(true);
    });

    it('true | true → true', () => {
      const result = mergeCanonItems(
        item({ needs_approval: true }),
        item({ needs_approval: true }),
      );
      expect(result.needs_approval).toBe(true);
    });
  });
});
