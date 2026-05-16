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
    it('schemaVersion is the literal 5', () => {
      expectTypeOf<CanonItem['schemaVersion']>().toEqualTypeOf<5>();
    });

    it('updatedAt is a string', () => {
      expectTypeOf<CanonItem['updatedAt']>().toEqualTypeOf<string>();
    });
  });

  describe('createCanonItem defaults', () => {
    it('newly created item has schemaVersion 5', () => {
      const result = createCanonItem({ name: 'Tomato' }, counterIds());
      expect(result.kind === 'ok' && result.value.schemaVersion).toBe(5);
    });

    it('newly created item has empty updatedAt (pre-sync sentinel)', () => {
      const result = createCanonItem({ name: 'Tomato' }, counterIds());
      expect(result.kind === 'ok' && result.value.updatedAt).toBe('');
    });
  });
});
