import { describe, it, expect } from 'vitest';
import { appendCanonSynonym } from '@salt/domain';
import type { CanonItem } from '@salt/domain';

const base: CanonItem = {
  id: 'item-1',
  schemaVersion: 5,
  name: 'Tomatoes',
  synonyms: [],
  aisleId: null,
  thumbnail: null,
  embedding: null,
  needs_approval: false,
  shoppingBehavior: 'needed',
  updatedAt: '',
};

describe('appendCanonSynonym', () => {
  it('appends the normalised synonym and flags for review', () => {
    const next = appendCanonSynonym(base, 'Passata');
    expect(next.synonyms).toEqual(['passata']);
    expect(next.needs_approval).toBe(true);
  });

  // Issue #193 — the queue row and the review panel need to name the synonym
  // that was added and the entry it came from.
  describe('pendingChanges recording', () => {
    it('records a synonym_added entry naming the synonym', () => {
      const next = appendCanonSynonym(base, 'passata');
      expect(next.pendingChanges).toEqual([{ kind: 'synonym_added', synonym: 'passata' }]);
    });

    it('carries rawInput when the raw entry differs from the stored synonym', () => {
      // normaliseName strips the quantity and singularises, so the entry the
      // user actually typed is nowhere in the synonym — this is the case the
      // review panel exists for.
      const next = appendCanonSynonym(base, '2 tins chopped toms');
      expect(next.pendingChanges).toEqual([
        {
          kind: 'synonym_added',
          synonym: 'tin chopped tom',
          rawInput: '2 tins chopped toms',
        },
      ]);
    });

    it('omits rawInput when the raw entry is literally the synonym stored', () => {
      // A LITERAL compare (issue #193 decision 1) — a normalised one would be
      // true by construction and would silently drop every `from "…"` line.
      expect(appendCanonSynonym(base, 'passata').pendingChanges).toEqual([
        { kind: 'synonym_added', synonym: 'passata' },
      ]);
      expect(appendCanonSynonym(base, '  passata  ').pendingChanges).toEqual([
        { kind: 'synonym_added', synonym: 'passata' },
      ]);
      expect(appendCanonSynonym(base, 'Passata').pendingChanges).toEqual([
        { kind: 'synonym_added', synonym: 'passata', rawInput: 'Passata' },
      ]);
    });

    it('accumulates entries in the order they happened, most recent last', () => {
      const first = appendCanonSynonym(base, 'passata');
      const second = appendCanonSynonym(first, 'sugo');
      expect(
        second.pendingChanges?.map((c) => (c.kind === 'synonym_added' ? c.synonym : c.kind)),
      ).toEqual(['passata', 'sugo']);
    });

    it('appends after a created entry rather than replacing it', () => {
      const created: CanonItem = {
        ...base,
        needs_approval: true,
        pendingChanges: [{ kind: 'created' }],
      };
      const next = appendCanonSynonym(created, 'passata');
      expect(next.pendingChanges).toEqual([
        { kind: 'created' },
        { kind: 'synonym_added', synonym: 'passata' },
      ]);
    });
  });

  // CRITICAL: matchOrCreate's resolveMatch uses `updated !== item` to decide
  // whether to write. Recording a change on a no-op would mean a Firestore
  // write on every match that changed nothing.
  describe('no-op returns the SAME REFERENCE (load-bearing identity)', () => {
    const withSynonym: CanonItem = { ...base, synonyms: ['passata'] };

    it('when the synonym is already present', () => {
      expect(appendCanonSynonym(withSynonym, 'Passata')).toBe(withSynonym);
    });

    it('when the raw name normalises onto the item name', () => {
      expect(appendCanonSynonym(base, ' TOMATOES ')).toBe(base);
    });

    it('when the raw name is empty', () => {
      expect(appendCanonSynonym(base, '   ')).toBe(base);
    });

    it('records nothing on a no-op, even on an item that already has entries', () => {
      const flagged: CanonItem = {
        ...withSynonym,
        pendingChanges: [{ kind: 'synonym_added', synonym: 'passata' }],
      };
      const next = appendCanonSynonym(flagged, 'passata');
      expect(next).toBe(flagged);
      expect(next.pendingChanges).toHaveLength(1);
    });
  });
});
