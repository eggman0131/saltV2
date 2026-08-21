import { describe, it, expect } from 'vitest';
import { findExactCanonMatch } from '@salt/domain';
import type { CanonItem } from '@salt/domain';

function item(id: string, name: string, synonyms: string[] = []): CanonItem {
  return {
    id,
    schemaVersion: 5,
    name,
    synonyms,
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
  };
}

const bay = item('bay', 'Bay Leaves', ['bay leaf']);
const lime = item('lime', 'Lime', ['persian lime']);

describe('findExactCanonMatch', () => {
  it('matches an item by its own name', () => {
    expect(findExactCanonMatch([bay, lime], 'Lime')?.id).toBe('lime');
  });

  it('matches an item by a stored synonym', () => {
    expect(findExactCanonMatch([bay, lime], 'bay leaf')?.id).toBe('bay');
  });

  it('folds case, spacing and plurals like the rest of the matcher', () => {
    expect(findExactCanonMatch([bay, lime], '  PERSIAN   Limes ')?.id).toBe('lime');
  });

  it('prefers a name match over another item that carries it as a synonym', () => {
    const impostor = item('other', 'Something Else', ['lime']);
    expect(findExactCanonMatch([impostor, lime], 'lime')?.id).toBe('lime');
  });

  // The whole value of this query is that it speaks ONLY for stages 1 and 3 —
  // the two that answer from a string somebody wrote down. Everything below is a
  // similarity score, and a similarity score must not be allowed to outrank a
  // product form, or every derivative gets swallowed by its parent and no form is
  // ever proposed again.
  describe('says nothing about a mere resemblance', () => {
    it.each([
      ['lime zest', 'shares a token with Lime — stage 2 territory'],
      ['fresh lime juice', 'likewise'],
      ['bay leaves and thyme', 'contains the name but is not it'],
      ['limes', 'plural is folded, but "limes" IS Lime — see below'],
    ])('%s', (raw) => {
      const hit = findExactCanonMatch([bay, lime], raw);
      // "limes" singularises onto "lime", which IS an exact name match.
      if (raw === 'limes') expect(hit?.id).toBe('lime');
      else expect(hit).toBeNull();
    });
  });

  describe('returns null rather than guessing', () => {
    it('on empty or whitespace-only input', () => {
      expect(findExactCanonMatch([bay, lime], '   ')).toBeNull();
    });

    it('on an empty catalog', () => {
      expect(findExactCanonMatch([], 'lime')).toBeNull();
    });

    it('when two items share the same name — a duplicate is not an answer', () => {
      const dup = item('lime2', 'lime');
      expect(findExactCanonMatch([lime, dup], 'Lime')).toBeNull();
    });

    it('when two items claim the same synonym', () => {
      const a = item('a', 'Alpha', ['shared']);
      const b = item('b', 'Beta', ['shared']);
      expect(findExactCanonMatch([a, b], 'shared')).toBeNull();
    });
  });
});
