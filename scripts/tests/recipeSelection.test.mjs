// Pins scripts/lib/recipeSelection.mjs's `selectRecipesToAsk` (issue #1210
// review, blocking 2). Before this test existed, only `hasPhaseStrip` — the
// predicate — was pinned; the arrow choosing which predicate counts as "done"
// for `--missing-phases` had no test at all, so inverting it (asking recipes
// that already HAVE a strip instead of ones that don't) left every other gate
// green while overwriting every hand-corrected strip from #1202 phase 2 across
// the whole library.

import { describe, it, expect } from 'vitest';

import { selectRecipesToAsk } from '../lib/recipeSelection.mjs';

const recipe = (id, overrides = {}) => ({ id, estimated: false, hasStrip: false, ...overrides });

describe('selectRecipesToAsk', () => {
  it('default mode (#952): asks recipes with no timesEstimatedAt stamp, skips the estimated ones', () => {
    const cookable = [recipe('unstamped'), recipe('stamped', { estimated: true })];

    const { toAsk, alreadyDone } = selectRecipesToAsk(cookable, {
      missingPhases: false,
      redo: false,
    });

    expect(toAsk.map((r) => r.id)).toEqual(['unstamped']);
    expect(alreadyDone.map((r) => r.id)).toEqual(['stamped']);
  });

  it('--missing-phases (#1210): asks recipes with NO phase strip, and never one that already has one', () => {
    // Deliberately stamped-but-no-strip and unstamped-but-has-a-strip, so a test
    // that accidentally kept keying on the stamp instead of the strip would fail
    // here rather than pass by coincidence.
    const cookable = [
      recipe('no-strip', { estimated: true, hasStrip: false }),
      recipe('has-strip', { estimated: false, hasStrip: true }),
    ];

    const { toAsk, alreadyDone } = selectRecipesToAsk(cookable, {
      missingPhases: true,
      redo: false,
    });

    expect(toAsk.map((r) => r.id)).toEqual(['no-strip']);
    expect(alreadyDone.map((r) => r.id)).toEqual(['has-strip']);
    // The destructive regression this pins: inverting the selection arrow puts
    // 'has-strip' into toAsk and overwrites a hand-corrected strip.
    expect(toAsk.some((r) => r.hasStrip)).toBe(false);
  });

  it('a strip whose minutes sum to zero still counts as "already has a strip"', () => {
    // hasPhaseStrip treats a zeroed strip as a real strip (recipePhaseStrip.mjs);
    // selection must inherit that rather than re-deriving it.
    const cookable = [recipe('zeroed-strip', { estimated: true, hasStrip: true })];

    const { toAsk, alreadyDone } = selectRecipesToAsk(cookable, {
      missingPhases: true,
      redo: false,
    });

    expect(toAsk).toEqual([]);
    expect(alreadyDone.map((r) => r.id)).toEqual(['zeroed-strip']);
  });

  it('--redo asks every cookable recipe regardless of stamp or strip', () => {
    const cookable = [recipe('a', { estimated: true, hasStrip: true }), recipe('b')];

    const { toAsk, alreadyDone } = selectRecipesToAsk(cookable, {
      missingPhases: false,
      redo: true,
    });

    expect(toAsk.map((r) => r.id)).toEqual(['a', 'b']);
    expect(alreadyDone).toEqual([]);
  });

  it('--redo with --missing-phases still asks everything — the CLI refuses this combination, not this function', () => {
    const cookable = [recipe('a', { estimated: true, hasStrip: true })];

    const { toAsk, alreadyDone } = selectRecipesToAsk(cookable, {
      missingPhases: true,
      redo: true,
    });

    expect(toAsk.map((r) => r.id)).toEqual(['a']);
    expect(alreadyDone).toEqual([]);
  });
});
