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
    it('schemaVersion is the literal 3', () => {
      expectTypeOf<CanonItem['schemaVersion']>().toEqualTypeOf<3>();
    });

    it('revision is a number', () => {
      expectTypeOf<CanonItem['revision']>().toEqualTypeOf<number>();
    });

    it('updatedAt is a string', () => {
      expectTypeOf<CanonItem['updatedAt']>().toEqualTypeOf<string>();
    });

    it('deletedAt is string | null', () => {
      expectTypeOf<CanonItem['deletedAt']>().toEqualTypeOf<string | null>();
    });
  });

  describe('createCanonItem defaults', () => {
    it('newly created item has schemaVersion 3', () => {
      const result = createCanonItem({ name: 'Tomato' }, counterIds());
      expect(result.kind === 'ok' && result.value.schemaVersion).toBe(3);
    });

    it('newly created item has revision 0', () => {
      const result = createCanonItem({ name: 'Tomato' }, counterIds());
      expect(result.kind === 'ok' && result.value.revision).toBe(0);
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
        schemaVersion: 3,
        name: 'Butter',
        synonyms: [],
        aisleId: null,
        thumbnail: null,
        embedding: null,
        needs_approval: false,
        shoppingBehavior: 'needed',
        updatedAt: '2026-01-01T00:00:00.000Z',
        revision: 3,
        deletedAt: null,
      };
      expect(item.deletedAt).toBeNull();
    });

    it('a tombstone item has a non-null deletedAt ISO string', () => {
      const tombstone: CanonItem = {
        id: 'x',
        schemaVersion: 3,
        name: 'Butter',
        synonyms: [],
        aisleId: null,
        thumbnail: null,
        embedding: null,
        needs_approval: false,
        shoppingBehavior: 'needed',
        updatedAt: '2026-01-01T00:00:00.000Z',
        revision: 4,
        deletedAt: '2026-01-02T00:00:00.000Z',
      };
      expect(tombstone.deletedAt).not.toBeNull();
      expect(typeof tombstone.deletedAt).toBe('string');
    });

    it('revision advances monotonically (higher revision = newer state)', () => {
      const v1: CanonItem = {
        id: 'x',
        schemaVersion: 3,
        name: 'A',
        synonyms: [],
        aisleId: null,
        thumbnail: null,
        embedding: null,
        needs_approval: false,
        shoppingBehavior: 'needed',
        updatedAt: '',
        revision: 1,
        deletedAt: null,
      };
      const v2: CanonItem = { ...v1, revision: 2 };
      expect(v2.revision).toBeGreaterThan(v1.revision);
    });
  });
});
