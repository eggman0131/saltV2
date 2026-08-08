import { describe, it, expect } from 'vitest';
import {
  STEP_RULES,
  FIRST_USE_ORDINAL_RULE,
  GUIDED_PREP_RULES,
  GUIDED_STEP_NOTE_RULES,
} from '../../src/flows/stepRules.js';

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

describe('GUIDED_PREP_RULES', () => {
  it('opens the prep bullet of a field list', () => {
    expect(GUIDED_PREP_RULES.startsWith('- prep:')).toBe(true);
  });

  it('demands ONE instruction per job and a container whenever something is set aside', () => {
    expect(GUIDED_PREP_RULES).toContain('ONE instruction');
    expect(GUIDED_PREP_RULES).toContain('what the result is set aside IN');
    // ...and says what null means, so "no container" is a choice rather than a gap.
    expect(GUIDED_PREP_RULES).toContain('null when nothing is set aside');
  });

  it('binds every ingredient id to exactly one prep entry — the disappearing-ingredient trap', () => {
    // The same trap FIRST_USE_ORDINAL_RULE closes for the method, one layer up: in
    // guided mode the prep list REPLACES the ingredient checklist, so an id named
    // nowhere is an ingredient the cook is never shown. "Exactly once" is what
    // makes the list a full account of the ingredients (and stops the same 400g of
    // passata being weighed into two bowls).
    expect(GUIDED_PREP_RULES).toContain('EXACTLY ONCE');
    expect(GUIDED_PREP_RULES).toContain('NEVER SEES');
  });

  it('carries the no-quantities rule into the prep list too', () => {
    // Amounts reach the cook beside the job, exactly as they reach them beside the
    // step. Restating them here would undo STEP_RULES at the point the cook reads.
    expect(STEP_RULES).toContain('NO QUANTITIES');
    expect(GUIDED_PREP_RULES).toContain('NO QUANTITIES');
  });
});

describe('GUIDED_STEP_NOTE_RULES', () => {
  it('opens the stepNotes bullet of a field list', () => {
    expect(GUIDED_STEP_NOTE_RULES.startsWith('- stepNotes:')).toBe(true);
  });

  it('forbids touching the step text at all', () => {
    // The whole premise of the guided layer: it only ever ADDS lines underneath.
    // A model that "improves" a step silently rewrites a recipe nobody asked it to.
    expect(GUIDED_STEP_NOTE_RULES).toContain(
      'NEVER rewrite, reword, re-time, split or merge a step',
    );
  });

  it('refuses an invented cue — null is the correct answer for most steps', () => {
    // A made-up cue is worse than no cue: it is a confident instruction to wait for
    // something that will never happen.
    expect(GUIDED_STEP_NOTE_RULES).toContain('A made-up cue is worse than no cue');
    expect(GUIDED_STEP_NOTE_RULES).toContain('null WHENEVER THERE IS NO GENUINE TEST');
  });

  it('confines check-ins to timed steps, strictly inside the timer', () => {
    // Phase 3 arms these off the step's own timer, so a check-in at or past the end
    // is a reminder that can never fire.
    expect(GUIDED_STEP_NOTE_RULES).toContain('ONLY on a step that already carries a timer');
    expect(GUIDED_STEP_NOTE_RULES).toContain('MUST BE LESS than the timer');
  });
});
