import { describe, it, expect } from 'vitest';
import { reconcileRecipeTimes } from '../../src/recipe/commands/reconcileRecipeTimes.js';

/**
 * The one `total >= prep + cook` reconciliation (issue #1116).
 *
 * The rows below are ported from the two CF suites that pinned the two copies —
 * `assembleRecipeDraft.test.ts` (:701-858) and `estimateRecipeTimes.test.ts`
 * (:53-101). Both stay green untouched, which is what proves neither call site
 * moved; these pin the rule where it now lives.
 */
describe('reconcileRecipeTimes', () => {
  // THE reason this function takes a parameter. Before #1116 this triple was the
  // one input the two live implementations answered differently, and nothing
  // asserted that the difference was meant. Asserting both answers side by side
  // in one test makes the divergence a property of the argument rather than of
  // whichever file you happened to open.
  it('answers the same missing-total triple two ways, on the argument alone', () => {
    const raw = { prepTimeMinutes: 20, cookTimeMinutes: 35, totalTimeMinutes: null };

    expect(reconcileRecipeTimes(raw, { deriveMissingTotal: false }).totalTimeMinutes).toBeNull();
    expect(reconcileRecipeTimes(raw, { deriveMissingTotal: true }).totalTimeMinutes).toBe(55);
  });

  // Every other input is answered identically whichever way the policy is set —
  // the claim the doc comment makes. Each row runs under both settings.
  it.each([
    ['raises a stated total below its parts', { p: 10, c: 35, t: 35 }, { p: 10, c: 35, t: 45 }],
    [
      'leaves a legitimate excess alone (an overnight prove)',
      { p: 20, c: 10, t: 762 },
      { p: 20, c: 10, t: 762 },
    ],
    ['leaves an exact total alone', { p: 20, c: 35, t: 55 }, { p: 20, c: 35, t: 55 }],
    [
      'will not derive from one known part',
      { p: 20, c: null, t: null },
      { p: 20, c: null, t: null },
    ],
    [
      'will not floor a stated total from one known part',
      { p: 40, c: null, t: 20 },
      { p: 40, c: null, t: 20 },
    ],
    [
      'passes a fully-null triple through',
      { p: null, c: null, t: null },
      { p: null, c: null, t: null },
    ],
    // Reconcile-then-fold, the ordering the doc comment argues: cook 0 is a real
    // "no cooking" answer, so the stated 5 is raised against raw 15 + 0 and only
    // THEN is the 0 folded. Folding first would read cook 0 as "not stated",
    // leave partsTotal null and let the understated 5 through.
    [
      'raises against a raw 0 part before folding it away',
      { p: 15, c: 0, t: 5 },
      { p: 15, c: null, t: 15 },
    ],
    ['folds an all-zero triple to null', { p: 0, c: 0, t: 0 }, { p: null, c: null, t: null }],
  ])('%s, under either policy', (_name, input, expected) => {
    const raw = {
      prepTimeMinutes: input.p,
      cookTimeMinutes: input.c,
      totalTimeMinutes: input.t,
    };
    const want = {
      prepTimeMinutes: expected.p,
      cookTimeMinutes: expected.c,
      totalTimeMinutes: expected.t,
    };
    expect(reconcileRecipeTimes(raw, { deriveMissingTotal: true })).toEqual(want);
    expect(reconcileRecipeTimes(raw, { deriveMissingTotal: false })).toEqual(want);
  });

  // The same ordering, on the derive path — and NOT policy-independent, because
  // both parts are known and the total is null, which is precisely the case the
  // first test above covers. Folding first would refuse to derive at all.
  it('derives from a raw 0 part before folding it away', () => {
    expect(
      reconcileRecipeTimes(
        { prepTimeMinutes: 15, cookTimeMinutes: 0, totalTimeMinutes: null },
        { deriveMissingTotal: true },
      ),
    ).toEqual({ prepTimeMinutes: 15, cookTimeMinutes: null, totalTimeMinutes: 15 });
  });

  it('does not mutate its input', () => {
    const raw = { prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 35 };
    reconcileRecipeTimes(raw, { deriveMissingTotal: true });
    expect(raw).toEqual({ prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 35 });
  });
});
