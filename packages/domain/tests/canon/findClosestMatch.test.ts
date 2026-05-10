import { describe, it, expect, vi } from 'vitest';
import { findClosestMatch } from '../../src/canon/queries/findClosestMatch.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

function item(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 4,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    deletedAt: null,
    ...overrides,
  };
}

const catalog: readonly CanonItem[] = [
  item({ id: '1', name: 'Tomato', synonyms: ['tom', 'tomate'] }),
  item({ id: '2', name: 'Olive Oil', synonyms: ['EVOO'] }),
  item({ id: '3', name: 'Butter', synonyms: [] }),
  item({ id: '4', name: 'Peanut Butter', synonyms: [] }),
];

describe('findClosestMatch — stage 1: exact normalised name match', () => {
  it('returns stage 1 match for exact name after normalisation', () => {
    const result = findClosestMatch(catalog, '  TOMATO  ');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.stage).toBe(1);
      expect(result.candidate.item.id).toBe('1');
      expect(result.candidate.confidence).toBe(1.0);
    }
  });

  it('handles multi-word exact match', () => {
    const result = findClosestMatch(catalog, 'olive oil');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.stage).toBe(1);
      expect(result.candidate.item.id).toBe('2');
    }
  });

  it('handles plurals via singularization', () => {
    const result = findClosestMatch(catalog, 'tomatoes');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.stage).toBe(1);
      expect(result.candidate.item.id).toBe('1');
    }
  });

  it('returns ambiguous when two items share the same normalised name', () => {
    const a = item({ id: 'a', name: 'apple' });
    const b = item({ id: 'b', name: 'Apple' }); // same normalised name
    const result = findClosestMatch([a, b], 'apple');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
    }
  });
});

describe('findClosestMatch — stage 2: token overlap', () => {
  it('returns stage 2 match when token overlap meets threshold', () => {
    const hit = findClosestMatch(
      [item({ id: 'x', name: 'Extra Virgin Olive Oil Sauce', synonyms: [] })],
      'extra virgin olive oil',
    );
    expect(hit.kind).toBe('match');
    if (hit.kind === 'match') {
      expect(hit.candidate.stage).toBe(2);
      expect(hit.candidate.confidence).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('does not proceed beyond stage 2 when threshold met with clear gap', () => {
    const items = [item({ id: 'x', name: 'Extra Virgin Olive Oil Sauce', synonyms: ['evoos'] })];
    const result = findClosestMatch(items, 'extra virgin olive oil');
    // Only one candidate above threshold → gap is large → match at stage 2
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.candidate.stage).toBe(2);
  });

  it('returns ambiguous when two candidates score above stage2Stop within ambiguityGap', () => {
    // Both items have the same token overlap score against 'peanut butter'
    const pb1 = item({ id: 'pb1', name: 'peanut butter smooth' });
    const pb2 = item({ id: 'pb2', name: 'peanut butter crunchy' });
    // Both score: tokenMatch('peanut butter', 'peanut butter smooth') and 'peanut butter crunchy'
    // 'peanut butter' (2 tokens) vs 'peanut butter smooth' (3 tokens): overlap=2, max=3 → 0.67 < 0.8
    // Need a case where best >= 0.8 but gap < 0.05
    // 'peanut butter smooth extra' (4 tokens) vs 'peanut butter' (2 tokens):
    //   tokenMatch = 2/4 = 0.5 < 0.8
    // Direct tie: two identical-scoring items that both pass stage2Stop
    const a = item({ id: 'a', name: 'extra virgin olive oil' });
    const b = item({ id: 'b', name: 'extra virgin olive oil' }); // identical normalised name
    // Stage 1 catches identical names → won't reach stage 2.
    // So test a real near-tie at stage 2:
    // 'a b c d e' vs 'a b c d e f' = 5/6 ≈ 0.833 and 'a b c d e g' = 5/6 ≈ 0.833 → tie
    const item1 = item({ id: 'i1', name: 'alpha beta gamma delta epsilon zeta' });
    const item2 = item({ id: 'i2', name: 'alpha beta gamma delta epsilon eta' });
    const result = findClosestMatch([item1, item2], 'alpha beta gamma delta epsilon');
    // Both items score 5/max(5,6)=5/6≈0.833 ≥ stage2Stop(0.8), gap=0 < ambiguityGap(0.05)
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
      expect(result.candidates.every((c) => c.stage === 2)).toBe(true);
    }
  });

  it('auto-matches the clear winner when gap >= ambiguityGap at stage 2', () => {
    // Only one candidate above stage2Stop → gap is large → clear match
    const items = [
      item({ id: 'x', name: 'Extra Virgin Olive Oil Sauce' }),
      item({ id: 'y', name: 'Tomato' }),
    ];
    const result = findClosestMatch(items, 'extra virgin olive oil');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.item.id).toBe('x');
      expect(result.candidate.stage).toBe(2);
    }
  });
});

describe('findClosestMatch — stage 3: synonym match', () => {
  it('returns stage 3 for exact synonym hit', () => {
    const result = findClosestMatch(catalog, 'tom');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.stage).toBe(3);
      expect(result.candidate.item.id).toBe('1');
      expect(result.candidate.confidence).toBe(1.0);
    }
  });

  it('is case-insensitive for synonyms', () => {
    const result = findClosestMatch(catalog, 'evoo');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.stage).toBe(3);
      expect(result.candidate.item.id).toBe('2');
    }
  });

  it('matches synonym plurals via singularization', () => {
    const result = findClosestMatch(catalog, 'toms');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.stage).toBe(3);
      expect(result.candidate.item.id).toBe('1');
    }
  });
});

describe('findClosestMatch — stage 4: string similarity', () => {
  it('returns stage 4 for a near-match above threshold', () => {
    // 'tomatoe' → distance 1 from 'tomato', score ~0.857 >= 0.85
    const result = findClosestMatch(catalog, 'tomatoe');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.candidate.stage).toBe(4);
      expect(result.candidate.item.id).toBe('1');
      expect(result.candidate.confidence).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('returns ambiguous when two candidates score above stage4Stop within ambiguityGap', () => {
    // Two very similar strings, both score >= 0.85 with a small gap between them
    const itemA = item({ id: 'a', name: 'tomatoe' }); // edit distance 1 from 'tomato' → ~0.857
    const itemB = item({ id: 'b', name: 'tomatox' }); // edit distance 1 from 'tomato' → ~0.857
    const result = findClosestMatch([itemA, itemB], 'tomato');
    // Both score ~0.857, gap ≈ 0 < ambiguityGap (0.05) → ambiguous
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.length).toBe(2);
      expect(result.candidates.every((c) => c.stage === 4)).toBe(true);
    }
  });
});

describe('findClosestMatch — no match', () => {
  it('returns none for an unrelated query', () => {
    expect(findClosestMatch(catalog, 'chia seeds').kind).toBe('none');
  });

  it('returns none for blank input', () => {
    expect(findClosestMatch(catalog, '   ').kind).toBe('none');
    expect(findClosestMatch(catalog, '').kind).toBe('none');
  });

  it('returns none for empty catalog', () => {
    expect(findClosestMatch([], 'tomato').kind).toBe('none');
  });
});
