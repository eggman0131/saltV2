// scripts/backfill-recipe-times.mjs's `--verify` reads only `timesEstimatedAt`
// and never compares it to `timesRequestedAt` (issue #952 phase 2 review,
// should-fix 1, [trivial]). On a `--redo` pass, a recipe whose SECOND estimate
// fails keeps its FIRST run's stamp, so it counts as `done`, its old
// (reconciling) times pass `reconciles()`, and `--verify` exits 0 reporting a
// clean sweep on an incomplete pass — exactly the run where a false green costs
// the most, because it is the one offered for "a deliberate second pass after
// the definition changes".
//
// Fix: treat `estimated` as `timesEstimatedAt >= timesRequestedAt`, not merely
// `timesEstimatedAt !== undefined`.

import { describe, it, expect } from 'vitest';

import { isTimesEstimated } from '../lib/recipeTimesEstimated.mjs';

describe('isTimesEstimated', () => {
  it('is not estimated when timesEstimatedAt was never stamped', () => {
    expect(isTimesEstimated(null, null)).toBe(false);
    expect(isTimesEstimated(1_700_000_000_000, null)).toBe(false);
  });

  it('is estimated on a first, ordinary pass (no redo in play)', () => {
    expect(isTimesEstimated(1_700_000_000_000, 1_700_000_005_000)).toBe(true);
  });

  it('is estimated when nothing has ever asked a second time', () => {
    // A pre-#952 recipe stamped by some other route with no recorded request —
    // does not arise from this script, but the comparison must not crash on it.
    expect(isTimesEstimated(null, 1_700_000_000_000)).toBe(true);
  });

  it('--redo regression: a stale stamp from BEFORE the latest request does not count as done', () => {
    // The exact shape from the review: --redo bumps timesRequestedAt to ask
    // again, the second estimate FAILS (the trigger never re-stamps on
    // failure), and the recipe is left with its first run's OLDER
    // timesEstimatedAt sitting behind the NEW timesRequestedAt. That must read
    // as still-pending, not done — this is the row that used to make --verify
    // report a clean sweep on an incomplete pass.
    const firstRunEstimatedAt = 1_699_000_000_000;
    const redoRequestedAt = 1_700_000_000_000; // bumped by --redo, no answer yet
    expect(isTimesEstimated(redoRequestedAt, firstRunEstimatedAt)).toBe(false);
  });

  it('a successful redo (second estimate lands) counts as done again', () => {
    const redoRequestedAt = 1_700_000_000_000;
    const secondRunEstimatedAt = 1_700_000_005_000; // after the redo request
    expect(isTimesEstimated(redoRequestedAt, secondRunEstimatedAt)).toBe(true);
  });
});
