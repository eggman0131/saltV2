import { describe, it, expect } from 'vitest';
import { MATCH_THRESHOLDS } from '@salt/domain';
import { fakeEmbedding } from '../../src/ai/fakeEmbedding.js';

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

describe('fakeEmbedding', () => {
  it('is deterministic for the same text', () => {
    expect(fakeEmbedding('cherry tomatoes')).toEqual(fakeEmbedding('cherry tomatoes'));
  });

  it('returns a fixed-width vector of signed components', () => {
    const values = fakeEmbedding('olive oil');
    expect(values).toHaveLength(64);
    expect(values.every((v) => v >= -1 && v <= 1)).toBe(true);
    expect(values.some((v) => v < 0)).toBe(true);
  });

  // The reason the stand-in is derived from the text at all: canon items are
  // embedded through this same fake, so a constant vector would score cosine 1.0
  // against every stored one and stage 5 would bind any unmatched name to an
  // arbitrary canon item. Unrelated names must stay well under the stage-5 stop.
  it('keeps distinct texts far below the stage-5 match threshold', () => {
    const names = [
      'olive oil',
      'tomato',
      'tinned tomatoes',
      'garlic',
      'lime',
      'olives',
      'chicken thigh',
      'plain flour',
      'butter',
      'milk',
      'red onion',
      'spring onion',
      'basil',
      'salt',
      'sugar',
      'lemon',
    ];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const score = cosine(fakeEmbedding(names[i]!), fakeEmbedding(names[j]!));
        expect(Math.abs(score)).toBeLessThan(MATCH_THRESHOLDS.stage5Stop);
      }
    }
  });

  it('scores an identical text as a perfect match', () => {
    expect(cosine(fakeEmbedding('garlic'), fakeEmbedding('garlic'))).toBeCloseTo(1, 10);
  });
});
