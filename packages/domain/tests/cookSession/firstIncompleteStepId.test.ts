import { describe, it, expect } from 'vitest';
import { firstIncompleteStepId } from '@salt/domain';
import type { StepDoc } from '@salt/domain/schemas';

// "Where was I?" — the earliest step still outstanding, in RECIPE order
// (issue #556). Drives land-on-first-incomplete and the footer's Resume label.

function step(id: string): StepDoc {
  return { id, text: `Do ${id}`, timer: null, note: null };
}

const STEPS = [step('s1'), step('s2'), step('s3'), step('s4')];

describe('firstIncompleteStepId', () => {
  // [label, completed ids, expected]
  const cases: Array<[string, string[], string | null]> = [
    ['nothing done yet', [], 's1'],
    ['the first step is done', ['s1'], 's2'],
    ['a run of steps is done', ['s1', 's2'], 's3'],
    ['all but the last are done', ['s1', 's2', 's3'], 's4'],
    ['every step is done', ['s1', 's2', 's3', 's4'], null],
    // RECIPE order wins over completion order: ticking step 3 first does not
    // skip step 2.
    ['a later step was ticked first', ['s3'], 's1'],
    ['steps 1 and 3 are done, 2 is not', ['s1', 's3'], 's2'],
    // A session can carry ids for steps edited out of the recipe.
    ['completion refers to a deleted step', ['gone'], 's1'],
    ['completion mixes live and deleted steps', ['s1', 'gone'], 's2'],
  ];

  it.each(cases)('returns %s → %s', (_label, completed, expected) => {
    expect(firstIncompleteStepId(STEPS, new Set(completed))).toBe(expected);
  });

  it('returns null for a recipe with no steps', () => {
    expect(firstIncompleteStepId([], new Set())).toBeNull();
    expect(firstIncompleteStepId([], new Set(['s1']))).toBeNull();
  });

  it('supports the "next outstanding step AFTER this one" read via a sliced list', () => {
    // The caller slices; this query has no notion of a cursor.
    const done = new Set(['s1']);
    expect(firstIncompleteStepId(STEPS.slice(2), done)).toBe('s3');
    expect(firstIncompleteStepId(STEPS.slice(4), done)).toBeNull();
  });

  it('is pure — does not mutate the steps or the completed set', () => {
    const steps = [step('s1'), step('s2')];
    const completed = new Set(['s1']);
    firstIncompleteStepId(steps, completed);
    expect(steps).toHaveLength(2);
    expect([...completed]).toEqual(['s1']);
  });
});
