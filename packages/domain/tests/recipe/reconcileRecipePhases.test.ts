import { describe, it, expect } from 'vitest';
import { reconcileRecipePhases } from '../../src/recipe/commands/reconcileRecipePhases.js';

const PREP = { label: 'Prep', handsOnMinutes: 10, handsOffMinutes: 0 };
const REST = { label: 'Rest', handsOnMinutes: 0, handsOffMinutes: 30 };
const SHAKE = { label: 'Shake', handsOnMinutes: 2, handsOffMinutes: 0 };

/**
 * The one merge of a fresh phase strip against a stored one (issue #1122
 * review, PR #1201 — blocking 1 & 2).
 */
describe('reconcileRecipePhases', () => {
  it('takes both fields from raw when raw answered', () => {
    const result = reconcileRecipePhases(
      { phases: [SHAKE], timingSummary: 'Two minutes.' },
      { phases: [PREP, REST], timingSummary: 'Old summary.' },
    );
    expect(result).toEqual({ phases: [SHAKE], timingSummary: 'Two minutes.' });
  });

  it('takes both fields from base when raw omitted phases', () => {
    const result = reconcileRecipePhases(
      { phases: undefined, timingSummary: undefined },
      { phases: [PREP, REST], timingSummary: 'Old summary.' },
    );
    expect(result).toEqual({ phases: [PREP, REST], timingSummary: 'Old summary.' });
  });

  it('treats an explicit empty array the same as an omitted key', () => {
    const result = reconcileRecipePhases(
      { phases: [], timingSummary: null },
      { phases: [PREP, REST], timingSummary: 'Old summary.' },
    );
    expect(result).toEqual({ phases: [PREP, REST], timingSummary: 'Old summary.' });
  });

  // The exact defect blocking-1 named: a re-estimate that returned three good
  // numbers but omitted the strip must not erase a stored one.
  it('never erases a stored strip when raw answered with no phases', () => {
    const result = reconcileRecipePhases(
      { phases: undefined, timingSummary: undefined },
      { phases: [PREP, REST], timingSummary: 'Old summary.' },
    );
    expect(result.phases).toEqual([PREP, REST]);
  });

  // The exact defect blocking-2 named: a fresh strip must never be stored under
  // a stale sentence, and a fresh sentence must never be stored over a stale
  // strip — the two fields move together, in both directions.
  it('does not pair a fresh strip with the stale summary', () => {
    const result = reconcileRecipePhases(
      { phases: [SHAKE], timingSummary: undefined },
      { phases: [PREP, REST], timingSummary: 'Old summary.' },
    );
    expect(result).toEqual({ phases: [SHAKE], timingSummary: null });
  });

  it('does not pair a fresh summary with the stale strip', () => {
    const result = reconcileRecipePhases(
      { phases: undefined, timingSummary: 'Fresh summary with no strip behind it.' },
      { phases: [PREP, REST], timingSummary: 'Old summary.' },
    );
    expect(result).toEqual({ phases: [PREP, REST], timingSummary: 'Old summary.' });
  });

  it('has nothing to protect on a fresh draft with no base', () => {
    const result = reconcileRecipePhases({ phases: undefined, timingSummary: undefined }, null);
    expect(result).toEqual({ phases: [], timingSummary: null });
  });
});
