import { describe, it, expect, vi } from 'vitest';
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

    it('when the name is a DERIVATION rather than another name for the item', () => {
      expect(appendCanonSynonym(base, 'sun-dried tomato', { isDerivedName: () => true })).toBe(
        base,
      );
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

// A synonym asserts IDENTITY ("another name for this item"); a product form
// asserts DERIVATION ("a thing you get FROM this item, at this yield"). Writing
// the second into the field that means the first is what put `lime zest` in
// Lime's synonym list next to a form saying zest is scraped from a lime — after
// which the matcher answers "zest IS a lime" at stage 3 and the yield is lost.
describe('isDerivedName guard', () => {
  const claimsZest = (rawName: string) => /zest/i.test(rawName);

  it('appends normally when the predicate declines the name', () => {
    const next = appendCanonSynonym(base, 'plum tomatoes', { isDerivedName: claimsZest });
    expect(next.synonyms).toEqual(['plum tomato']);
  });

  it('records no pending change when it refuses', () => {
    const next = appendCanonSynonym(base, 'tomato zest', { isDerivedName: claimsZest });
    expect(next.pendingChanges ?? []).toEqual([]);
    expect(next.needs_approval).toBe(false);
  });

  it('is handed the RAW name, not the normalised one', () => {
    // The honest implementation is `resolveProductForm(name, forms)`, which does
    // its own normalising. Handing it a pre-folded string would make the two
    // halves of one pipeline disagree about plurals and punctuation.
    const seen: string[] = [];
    appendCanonSynonym(base, '  Sun-Dried Tomatoes  ', {
      isDerivedName: (n) => {
        seen.push(n);
        return false;
      },
    });
    expect(seen).toEqual(['  Sun-Dried Tomatoes  ']);
  });

  it('is not consulted at all for a name that was already a no-op', () => {
    // The cheap structural guards run first, so a duplicate or self-named
    // synonym never pays for a forms lookup.
    const spy = vi.fn(() => true);
    const withSynonym: CanonItem = { ...base, synonyms: ['passata'] };
    expect(appendCanonSynonym(withSynonym, 'Passata', { isDerivedName: spy })).toBe(withSynonym);
    expect(spy).not.toHaveBeenCalled();
  });

  it('still threads reasoning through the options object', () => {
    const next = appendCanonSynonym(base, 'passata', { reasoning: 'same thing, Italian name' });
    expect(next.reasoning).toBe('same thing, Italian name');
    expect(next.synonyms).toEqual(['passata']);
  });
});
