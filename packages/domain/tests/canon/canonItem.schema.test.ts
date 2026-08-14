import { describe, it, expect, expectTypeOf } from 'vitest';
import { createCanonItem } from '@salt/domain';
import type { CanonItem, PendingCanonChange } from '@salt/domain';
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

  // Pending changes (issue #193). Optional + additive and, unlike the recipe
  // diff, PERSISTED — so it must be fully back-compat: canon docs written before
  // it shipped lack the field and must stay valid, or canonSubscription skips
  // them and the canon list empties.
  describe('pendingChanges field (back-compat)', () => {
    const baseDoc = {
      id: 'c1',
      schemaVersion: 5 as const,
      name: 'Tomatoes',
      synonyms: ['passata'],
      aisleId: null,
      thumbnail: null,
      embedding: null,
      needs_approval: true,
      shoppingBehavior: 'needed' as const,
      updatedAt: '',
    };

    it('parses a doc WITHOUT pendingChanges (old docs stay valid)', () => {
      const result = CanonItemSchema.safeParse(baseDoc);
      expect(result.success).toBe(true);
      expect(result.success && result.data.pendingChanges).toBeUndefined();
    });

    it('parses a doc WITH pendingChanges and carries the entries through', () => {
      const pendingChanges = [
        { kind: 'created', rawInput: '2 tins chopped toms' },
        { kind: 'synonym_added', synonym: 'passata' },
      ];
      const result = CanonItemSchema.safeParse({ ...baseDoc, pendingChanges });
      expect(result.success).toBe(true);
      expect(result.success && result.data.pendingChanges).toEqual(pendingChanges);
    });

    it('keeps schemaVersion at the literal 5 — an additive field must not bump it', () => {
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'created' }],
      });
      expect(result.success && result.data.schemaVersion).toBe(5);
    });

    it('rejects an unknown change kind (the union is closed)', () => {
      // Must be a kind the union does NOT carry. `aisle_cleared` was the
      // fixture until Phase 2 made it real — pick something still unknown.
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'aisle_reassigned' }],
      });
      expect(result.success).toBe(false);
    });

    // Aisle admin (issue #193, Phase 2): the flag the user caused themselves.
    it('parses an aisle_cleared entry from a merge', () => {
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'aisle_cleared', fromAisleId: 'a1', origin: 'aisle_merge' }],
      });
      expect(result.success).toBe(true);
      expect(result.success && result.data.pendingChanges).toEqual([
        { kind: 'aisle_cleared', fromAisleId: 'a1', origin: 'aisle_merge' },
      ]);
    });

    it('parses an aisle_cleared entry with a null fromAisleId', () => {
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'aisle_cleared', fromAisleId: null, origin: 'aisle_delete' }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects an aisle_cleared entry with an unknown origin', () => {
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'aisle_cleared', fromAisleId: 'a1', origin: 'ai_decided' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects an aisle_cleared entry with no origin', () => {
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'aisle_cleared', fromAisleId: 'a1' }],
      });
      expect(result.success).toBe(false);
    });

    it('parses a doc carrying several changes of different kinds, in order', () => {
      const pendingChanges = [
        { kind: 'created', rawInput: '2 tins chopped toms' },
        { kind: 'synonym_added', synonym: 'passata' },
        { kind: 'aisle_cleared', fromAisleId: 'a1', origin: 'aisle_merge' },
      ];
      const result = CanonItemSchema.safeParse({ ...baseDoc, pendingChanges });
      expect(result.success).toBe(true);
      expect(result.success && result.data.pendingChanges).toEqual(pendingChanges);
    });

    it('keeps schemaVersion at the literal 5 — a third union member must not bump it', () => {
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'aisle_cleared', fromAisleId: 'a1', origin: 'aisle_delete' }],
      });
      expect(result.success && result.data.schemaVersion).toBe(5);
    });

    it('rejects a synonym_added entry with no synonym', () => {
      const result = CanonItemSchema.safeParse({
        ...baseDoc,
        pendingChanges: [{ kind: 'synonym_added' }],
      });
      expect(result.success).toBe(false);
    });

    // canonSubscription launders the parsed doc through `as CanonItem`, so a
    // doc-type/entity-type divergence would NOT be caught by typecheck. Pin the
    // round trip: a pure CanonItem must parse, and parse back into a CanonItem.
    it('round-trips a domain CanonItem carrying pendingChanges', () => {
      const created = createCanonItem(
        { name: 'Tomatoes', rawInput: '2 tins chopped toms' },
        counterIds(),
      );
      expect(created.kind).toBe('ok');
      if (created.kind !== 'ok') return;
      const result = CanonItemSchema.safeParse(created.value);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const roundTripped: CanonItem = result.data;
      expect(roundTripped.pendingChanges).toEqual([
        { kind: 'created', rawInput: '2 tins chopped toms' },
      ]);
    });

    it('type-level: pendingChanges is an optional readonly array', () => {
      expectTypeOf<CanonItem['pendingChanges']>().toEqualTypeOf<
        readonly PendingCanonChange[] | undefined
      >();
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
