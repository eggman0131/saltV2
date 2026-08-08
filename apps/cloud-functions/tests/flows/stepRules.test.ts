import { describe, it, expect } from 'vitest';
import { STEP_RULES, FIRST_USE_ORDINAL_RULE } from '../../src/flows/stepRules.js';

// These are prompt FRAGMENTS, not whole prompts: each one is interpolated into the
// middle of a markdown field list in two different prompts (authorRecipe's
// LIBRARIAN_SYSTEM and extractRecipeFromUrl's FIELD_RULES). Getting the leading
// shape wrong doesn't fail a type check or a lint — it silently corrupts the bullet
// structure of both prompts at once, which is the whole thing this file exists to
// prevent. Hence the shape assertions below.

describe('STEP_RULES', () => {
  it('opens the steps bullet of a field list', () => {
    // Interpolated at column 0 as a top-level bullet in both prompts.
    expect(STEP_RULES.startsWith('- steps:')).toBe(true);
  });

  it('states both halves of the step policy', () => {
    // Not a paraphrase check — these two rules are the reason the file exists, and
    // the no-quantities half is what makes FIRST_USE_ORDINAL_RULE load-bearing
    // (see the coupling test below).
    expect(STEP_RULES).toContain('ONE COHERENT OPERATION PER STEP');
    expect(STEP_RULES).toContain('NO QUANTITIES');
  });

  it('times a duration range at its lower bound, leaving the range in the prose', () => {
    // The two halves are only correct together: taking the lower bound is useless if
    // the model also rewrites "10–15 minutes" down to "10 minutes", because then the
    // cook loses the upper bound entirely — the range reaches them ONLY via the step
    // text (nothing stores it — see the timerMinutes clause and issue #748).
    expect(STEP_RULES).toContain('take the LOWER bound');
    expect(STEP_RULES).toContain('Leave the range itself in text exactly as the source wrote it');
  });

  it('exempts times from the no-quantities rule', () => {
    // NO QUANTITIES is about ingredient amounts. Without saying so next to the range
    // clause, a model reading "never their amounts" has a licence to strip "10–15
    // minutes" out of the prose it was just told to preserve.
    expect(STEP_RULES).toContain('never strips a time from the prose');
  });
});

describe('FIRST_USE_ORDINAL_RULE', () => {
  it('reads as a mid-bullet clause, not a new bullet', () => {
    // Appended after "isOptional (…)," inside the ingredient bullet, so a leading
    // "- " here would split that bullet in two.
    expect(FIRST_USE_ORDINAL_RULE.startsWith('- ')).toBe(false);
    expect(FIRST_USE_ORDINAL_RULE.startsWith('firstUsedInStepOrdinal')).toBe(true);
  });

  it('permits null only when no step uses the ingredient', () => {
    // The coupling with STEP_RULES' no-quantities half: `firstUseByStep` in
    // @salt/domain drops an ingredient with no step id, so it shows at mise en place
    // and nowhere else. With amounts gone from the step text, a loosely-permitted
    // null makes that ingredient's quantity unreachable mid-cook. If the
    // no-quantities rule is ever dropped, this strictness can relax with it — but
    // not before.
    expect(STEP_RULES).toContain('NO QUANTITIES');
    expect(FIRST_USE_ORDINAL_RULE).toContain('Set it for EVERY ingredient that a step uses');
    expect(FIRST_USE_ORDINAL_RULE).toContain('Use null ONLY when no step uses the ingredient');
  });
});
