import { describe, it, expect, expectTypeOf } from 'vitest';
import { createCanonItem } from '@salt/domain';
import type { CanonItem } from '@salt/domain';
import type { IdGenerator } from '@salt/domain';

function counterIds(): IdGenerator {
  let n = 0;
  return { newCanonId: () => `id-${++n}`, newAisleId: () => `aisle-${++n}` };
}

describe('CanonItem schema', () => {
  describe('type-level: new fields exist with correct types', () => {
    it('schemaVersion is the literal 4', () => {
      expectTypeOf<CanonItem['schemaVersion']>().toEqualTypeOf<4>();
    });

    it('updatedAt is a string', () => {
      expectTypeOf<CanonItem['updatedAt']>().toEqualTypeOf<string>();
    });

    it('deletedAt is string | null', () => {
      expectTypeOf<CanonItem['deletedAt']>().toEqualTypeOf<string | null>();
    });
  });

  describe('createCanonItem defaults', () => {
    it('newly created item has schemaVersion 4', () => {
      const result = createCanonItem({ name: 'Tomato' }, counterIds());
      expect(result.kind === 'ok' && result.value.schemaVersion).toBe(4);
    });

    it('newly created item has empty updatedAt (pre-sync sentinel)', () => {
      const result = createCanonItem({ name: 'Tomato' }, counterIds());
      expect(result.kind === 'ok' && result.value.updatedAt).toBe('');
    });

    it('newly created item has deletedAt null', () => {
      const result = createCanonItem({ name: 'Tomato' }, counterIds());
      expect(result.kind === 'ok' && result.value.deletedAt).toBeNull();
    });
  });

  describe('soft-delete invariants', () => {
    it('a live item has deletedAt null', () => {
      const item: CanonItem = {
        id: 'x',
        schemaVersion: 4,
        name: 'Butter',
        synonyms: [],
        aisleId: null,
        thumbnail: null,
        embedding: null,
        needs_approval: false,
        shoppingBehavior: 'needed',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      };
      expect(item.deletedAt).toBeNull();
    });

    it('a tombstone item has a non-null deletedAt ISO string', () => {
      const tombstone: CanonItem = {
        id: 'x',
        schemaVersion: 4,
        name: 'Butter',
        synonyms: [],
        aisleId: null,
        thumbnail: null,
        embedding: null,
        needs_approval: false,
        shoppingBehavior: 'needed',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: '2026-01-02T00:00:00.000Z',
      };
      expect(tombstone.deletedAt).not.toBeNull();
      expect(typeof tombstone.deletedAt).toBe('string');
    });
  });
});
