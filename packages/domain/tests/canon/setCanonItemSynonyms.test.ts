import { describe, it, expect } from 'vitest';
import { setCanonItemSynonyms } from '../../src/canon/commands/setCanonItemSynonyms.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function item(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'c1',
    schemaVersion: 2,
    name: 'Olive Oil',
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    ...overrides,
  };
}

describe('setCanonItemSynonyms', () => {
  it('sets synonyms on an item', () => {
    const result = setCanonItemSynonyms(item(), ['EVOO', 'liquid gold']);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO', 'liquid gold']);
  });

  it('trims whitespace from each synonym', () => {
    const result = setCanonItemSynonyms(item(), ['  EVOO  ', ' liquid gold ']);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO', 'liquid gold']);
  });

  it('removes empty strings after trimming', () => {
    const result = setCanonItemSynonyms(item(), ['EVOO', '   ', '']);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO']);
  });

  it('deduplicates synonyms', () => {
    const result = setCanonItemSynonyms(item(), ['EVOO', 'EVOO', 'liquid gold']);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual(['EVOO', 'liquid gold']);
  });

  it('accepts an empty array, clearing all synonyms', () => {
    const result = setCanonItemSynonyms(item({ synonyms: ['EVOO'] }), []);
    if (result.kind === 'ok') expect(result.value.synonyms).toEqual([]);
  });

  it('preserves all other fields', () => {
    const original = item({ name: 'Olive Oil', aisleId: 'oils' });
    const result = setCanonItemSynonyms(original, ['EVOO']);
    if (result.kind === 'ok') {
      expect(result.value.id).toBe(original.id);
      expect(result.value.name).toBe(original.name);
      expect(result.value.aisleId).toBe(original.aisleId);
    }
  });

  // Issue #193 — editing the synonyms is how you disagree with a recorded
  // `synonym_added`; there is no reject action. A record whose synonym is gone
  // must go with it, or the panel claims credit for a synonym that isn't there.
  describe('stale pendingChanges pruning', () => {
    const flagged = item({
      synonyms: ['passata', 'sugo'],
      needs_approval: true,
      pendingChanges: [
        { kind: 'created' },
        { kind: 'synonym_added', synonym: 'passata' },
        { kind: 'synonym_added', synonym: 'sugo', rawInput: '1 jar sugo' },
      ],
    });

    it('drops the record for a synonym that was removed', () => {
      const result = setCanonItemSynonyms(flagged, ['passata']);
      if (result.kind !== 'ok') return;
      expect(result.value.pendingChanges).toEqual([
        { kind: 'created' },
        { kind: 'synonym_added', synonym: 'passata' },
      ]);
    });

    it('keeps a record whose synonym survives under a different spelling', () => {
      // The compare is normalised, so re-typed casing/plurality still matches.
      const result = setCanonItemSynonyms(flagged, ['Passata', 'Sugos']);
      if (result.kind !== 'ok') return;
      expect(result.value.pendingChanges).toHaveLength(3);
    });

    it('never touches a created record — it names no synonym', () => {
      const result = setCanonItemSynonyms(flagged, []);
      if (result.kind !== 'ok') return;
      expect(result.value.pendingChanges).toEqual([{ kind: 'created' }]);
    });

    it('omits the key when nothing survives, rather than writing an empty array', () => {
      const onlySynonyms = item({
        synonyms: ['passata'],
        pendingChanges: [{ kind: 'synonym_added', synonym: 'passata' }],
      });
      const result = setCanonItemSynonyms(onlySynonyms, []);
      if (result.kind !== 'ok') return;
      expect(result.value).not.toHaveProperty('pendingChanges');
    });

    it('leaves an item with no record untouched (back-compat)', () => {
      const result = setCanonItemSynonyms(item({ synonyms: ['passata'] }), ['passata']);
      if (result.kind !== 'ok') return;
      expect(result.value).not.toHaveProperty('pendingChanges');
    });
  });
});
