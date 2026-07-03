import { describe, it, expect, expectTypeOf } from 'vitest';
import { createCanonItem } from '@salt/domain';
import type { CanonItem } from '@salt/domain';
import type { IdGenerator } from '@salt/domain';
import { CanonItemSchema } from '@salt/domain/schemas';

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

  // Distributed-trace correlation field (issue #362, Phase 5). Optional + additive
  // so it must be fully back-compat: old docs that lack it stay valid.
  describe('traceContext field (back-compat)', () => {
    const baseDoc = {
      id: 'c1',
      schemaVersion: 5 as const,
      name: 'Tomato',
      synonyms: [],
      aisleId: null,
      thumbnail: null,
      embedding: null,
      needs_approval: false,
      shoppingBehavior: 'needed' as const,
      updatedAt: '',
    };

    it('parses a doc WITHOUT traceContext (old docs stay valid)', () => {
      const result = CanonItemSchema.safeParse(baseDoc);
      expect(result.success).toBe(true);
      expect(result.success && result.data.traceContext).toBeUndefined();
    });

    it('parses a doc WITH traceContext and carries the string through', () => {
      const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
      const result = CanonItemSchema.safeParse({ ...baseDoc, traceContext: traceparent });
      expect(result.success).toBe(true);
      expect(result.success && result.data.traceContext).toBe(traceparent);
    });
  });

  // Embedding relocation (issue #410). The vector moved to the server-only
  // canonEmbeddings collection; `embedding` is now OPTIONAL on the canon doc so
  // both shapes stay valid on read: migrated docs (no field) and un-migrated docs
  // (inline vector, read by the adapter's fallback).
  describe('embedding field (relocation back-compat)', () => {
    const baseDoc = {
      id: 'c1',
      schemaVersion: 5 as const,
      name: 'Tomato',
      synonyms: [],
      aisleId: null,
      thumbnail: null,
      needs_approval: false,
      shoppingBehavior: 'needed' as const,
      updatedAt: '',
    };

    it('parses a migrated doc with NO embedding field', () => {
      const result = CanonItemSchema.safeParse(baseDoc);
      expect(result.success).toBe(true);
      expect(result.success && result.data.embedding).toBeUndefined();
    });

    it('parses an un-migrated doc with an inline embedding array', () => {
      const result = CanonItemSchema.safeParse({ ...baseDoc, embedding: [0.1, 0.2, 0.3] });
      expect(result.success).toBe(true);
      expect(result.success && result.data.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it('still parses a doc with an explicit null embedding', () => {
      const result = CanonItemSchema.safeParse({ ...baseDoc, embedding: null });
      expect(result.success).toBe(true);
      expect(result.success && result.data.embedding).toBeNull();
    });
  });
});
