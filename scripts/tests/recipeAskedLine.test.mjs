// Regression for issue #1254 review, blocking 1: `backfill-recipe-times.mjs`'s
// write loop called `triple(r.times)` in its success log line — a function and
// a field #1248 deleted everywhere else in the file. Because the call sat AFTER
// the PATCH succeeded and AFTER `asked` was incremented, every `--apply` write
// threw a `ReferenceError` straight into the loop's own `catch`, which counted
// the same recipe as both `asked` (already incremented) and `FAILED` (the
// exception) — a production sweep over N recipes wrote all N and reported
// `asked N … failed N`, exit code 1.
//
// A source-text grep could not have caught this: the call site never named
// `times` as a *string* the way the retired schema keys do — `r.times` and
// `triple` are bare identifiers, invisible to `.includes('times')`-style
// scanning without an unworkable false-positive rate (the file says "times"
// constantly). The only thing that reliably catches "this identifier does not
// exist" is calling the code and letting the reference fail — which the write
// loop's top-level `gcloud`/network calls make impossible to do against the
// script directly. `recipeAskedLine` gives the line a name so a test can call
// it the same way the loop does.
//
// Before the fix, calling this with a real `{ id, title }` recipe — the only
// shape the write loop's `r` has since #1248 — throws `ReferenceError: triple
// is not defined`. This test is red on that code and green once the call site
// stops naming a deleted identifier.

import { describe, it, expect } from 'vitest';

import { recipeAskedLine } from '../lib/recipeAskedLine.mjs';

describe('recipeAskedLine', () => {
  it('formats the success line from only the fields the write loop still has', () => {
    const recipe = { id: 'r1', title: 'Penne all’Arrabbiata' };

    expect(() => recipeAskedLine(recipe)).not.toThrow();
    expect(recipeAskedLine(recipe)).toBe('  asked   r1  Penne all’Arrabbiata');
  });

  it('does not reach for a `times` field — the write loop’s recipe never has one', () => {
    // No `times` property at all, matching the shape `toAsk` entries actually
    // have (id, title, kind, estimated, hasStrip — see backfill-recipe-times.mjs
    // `listRecipes`). A reintroduced reference to `recipe.times` would still
    // pass this call (reading an absent property is not an error) but the point
    // stands with the ReferenceError case above: nothing here can be satisfied
    // by decoding retired data.
    const recipe = { id: 'r2', title: 'Paneer Makhanwala' };

    expect(recipeAskedLine(recipe)).toBe('  asked   r2  Paneer Makhanwala');
  });
});
