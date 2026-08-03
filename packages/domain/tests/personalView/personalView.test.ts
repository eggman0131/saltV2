import { describe, it, expect } from 'vitest';
import { needsReview, type Recipe, type RecipeKind } from '../../src/index.js';

// The projection behind "Mine" (issues #634, #682). Once four helpers; #682 cut
// /mine back to "what of mine is running right now, and what needs a look", which
// left exactly one piece of policy in the domain layer: what still wants checking.

function recipe(id: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    schemaVersion: 1,
    kind: 'recipe',
    title: id,
    description: null,
    ingredients: [],
    steps: [],
    metadata: {
      servings: 2,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    image: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  } as Recipe;
}

describe('needsReview', () => {
  it('flags an entry nobody has saved since it landed', () => {
    expect(needsReview(recipe('fresh'))).toBe(true);
  });

  it('clears the moment somebody saves it', () => {
    // The editor save IS the review. Note what this does NOT include: viewing a
    // recipe writes nothing, so reading it leaves it in the queue.
    expect(needsReview(recipe('edited', { updatedAt: '2026-08-01T09:02:00.000Z' }))).toBe(false);
  });

  it('has no time limit — the import you forgot about is the point (#682)', () => {
    // The 24-hour window this replaced threw away exactly the case worth catching.
    const ancient = recipe('ancient', {
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(needsReview(ancient)).toBe(true);
  });

  it('does not care where the entry came from', () => {
    // The old predicate only ever surfaced `source.type === 'url'`, which silently
    // excluded photo/book imports (#676) — a photographed cookbook page is exactly
    // what wants checking.
    for (const source of [
      { type: 'url', url: 'https://example.com/r' },
      { type: 'book', title: 'Salt Fat Acid Heat' },
      { type: 'manual' },
      null,
    ] as Recipe['source'][]) {
      expect(needsReview(recipe('any', { source }))).toBe(true);
    }
  });

  it('only surfaces entries that are actually cookable', () => {
    // The capability gate, and the only reason the queue is usable on day one:
    // placeholders and outings are written once and never edited, so without it
    // every stock-photo night would sit here for ever with nothing to review.
    const cookable: RecipeKind[] = ['recipe', 'cocktail'];
    const not: RecipeKind[] = ['outing', 'placeholder'];
    for (const kind of cookable) expect(needsReview(recipe(kind, { kind }))).toBe(true);
    for (const kind of not) expect(needsReview(recipe(kind, { kind }))).toBe(false);
  });

  it('asks the capability, never the kind — an edited outing is still out', () => {
    const outing = recipe('outing', { kind: 'outing', updatedAt: '2026-08-02T09:00:00.000Z' });
    expect(needsReview(outing)).toBe(false);
  });

  it('reads no clock, so the same document always answers the same way', () => {
    const r = recipe('stable');
    expect(needsReview(r)).toBe(needsReview(r));
  });
});
