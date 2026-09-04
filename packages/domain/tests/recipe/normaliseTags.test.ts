import { describe, it, expect } from 'vitest';
import { normaliseTags } from '../../src/recipe/commands/normaliseTags.js';

/**
 * The one tag normalisation (issue #1054, Phase 5).
 *
 * The first row was ported from the `categoriseRecipe` flow's own test, so the
 * rule is pinned where it now lives rather than only through the flow that
 * happened to own it. That porting is what let #1249 retire that flow — and
 * delete its test — without losing the table.
 */
describe('normaliseTags', () => {
  it('lowercases, kebab-cases, comma-splits and dedupes — the ported model-output table', () => {
    expect(normaliseTags(['Italian', 'Comfort Food, Main', 'MAIN', 'italian', ''])).toEqual([
      'italian',
      'comfort-food',
      'main',
    ]);
  });

  // One row per transformation, each naming itself (UT-D1/D2).
  it.each([
    ['leaves an already-normalised tag alone', ['vegetarian'], ['vegetarian']],
    ['lowercases', ['Vegetarian'], ['vegetarian']],
    ['kebab-cases a space', ['Comfort Food'], ['comfort-food']],
    ['collapses a run of whitespace to one hyphen', ['batch   cook'], ['batch-cook']],
    ['trims the ends', ['  spicy  '], ['spicy']],
    ['splits a comma list into separate tags', ['vegetarian, quick'], ['vegetarian', 'quick']],
    ['splits on a comma with no space', ['a,b'], ['a', 'b']],
    ['drops the empties a trailing comma leaves', ['vegetarian,'], ['vegetarian']],
    ['drops a whitespace-only entry', ['   '], []],
    ['dedupes across entries', ['quick', 'Quick', ' QUICK '], ['quick']],
    ['dedupes within one comma list', ['quick, quick'], ['quick']],
    ['keeps first-occurrence order', ['b', 'a', 'b'], ['b', 'a']],
    ['answers empty for no tags at all', [], []],
  ])('%s', (_name, input, expected) => {
    expect(normaliseTags(input)).toEqual(expected);
  });

  it('is idempotent — its own output normalises to itself', () => {
    // What lets the recipe editor run a suggestion chip's existing tag back
    // through the same function without it changing under them. Stated over a
    // spread of inputs rather than one example.
    for (const raw of [
      ['Comfort Food, Main'],
      ['vegetarian, quick'],
      ['  BATCH   cook '],
      ['a,b,,c'],
    ]) {
      const once = normaliseTags(raw);
      expect(normaliseTags(once)).toEqual(once);
    }
  });

  it('leaves a legacy malformed tag alone rather than repairing it', () => {
    // The boundary of the fix: Exception 1 changes what is CREATED, never what is
    // read. A `vegetarian,-quick` already in production keeps rendering and keeps
    // being searchable — but it does split if it is ever re-entered, because the
    // comma is still a comma.
    expect(normaliseTags(['vegetarian,-quick'])).toEqual(['vegetarian', '-quick']);
  });
});
