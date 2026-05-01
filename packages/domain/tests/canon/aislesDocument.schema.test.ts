import { describe, it, expect, expectTypeOf } from 'vitest';
import type { AislesDocument } from '@salt/domain';
import type { Aisle } from '@salt/domain';

describe('AislesDocument schema', () => {
  describe('type-level: shape is correct', () => {
    it('schemaVersion is the literal 1', () => {
      expectTypeOf<AislesDocument['schemaVersion']>().toEqualTypeOf<1>();
    });

    it('revision is a number', () => {
      expectTypeOf<AislesDocument['revision']>().toEqualTypeOf<number>();
    });

    it('updatedAt is a string', () => {
      expectTypeOf<AislesDocument['updatedAt']>().toEqualTypeOf<string>();
    });

    it('aisles is a readonly Aisle array', () => {
      expectTypeOf<AislesDocument['aisles']>().toEqualTypeOf<readonly Aisle[]>();
    });
  });

  describe('wrapper-doc defaults and invariants', () => {
    it('accepts a valid document with zero revision', () => {
      const doc: AislesDocument = {
        schemaVersion: 1,
        revision: 0,
        updatedAt: '',
        aisles: [],
      };
      expect(doc.revision).toBe(0);
      expect(doc.aisles).toHaveLength(0);
    });

    it('accepts a document with populated aisles', () => {
      const doc: AislesDocument = {
        schemaVersion: 1,
        revision: 5,
        updatedAt: '2026-01-01T00:00:00.000Z',
        aisles: [
          { id: 'a1', name: 'Produce', order: 0 },
          { id: 'a2', name: 'Dairy', order: 1 },
        ],
      };
      expect(doc.aisles).toHaveLength(2);
      expect(doc.revision).toBe(5);
    });

    it('revision advances monotonically (higher = newer)', () => {
      const v1: AislesDocument = { schemaVersion: 1, revision: 3, updatedAt: '', aisles: [] };
      const v2: AislesDocument = { ...v1, revision: 4 };
      expect(v2.revision).toBeGreaterThan(v1.revision);
    });

    it('individual Aisle entities are unchanged from their own schema', () => {
      const aisle: Aisle = { id: 'a1', name: 'Produce', order: 0 };
      const doc: AislesDocument = {
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        aisles: [aisle],
      };
      expect(doc.aisles[0]).toEqual(aisle);
    });
  });
});
