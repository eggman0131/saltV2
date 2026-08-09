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

  it('demands a container name no other job uses (issue #761)', () => {
    // The container name is the plan's only join between its two halves, and it is
    // load-bearing: a step reaching for "small bowl" when two jobs filled a "small
    // bowl" is shown the FIRST one's contents, silently and possibly wrongly.
    expect(GUIDED_PREP_RULES).toContain(
      'EVERY CONTAINER NAME MUST BE UNIQUE ACROSS THE WHOLE PREP LIST',
    );
    expect(GUIDED_PREP_RULES).toContain('Never the same name twice');
  });

  it('pushes names that say what is IN the bowl, not numbered duplicates', () => {
    // "small bowl 1" / "small bowl 2" satisfies uniqueness and helps nobody: the
    // cook has to remember which number holds what. A name that says its contents
    // is self-checking at the bench.
    expect(GUIDED_PREP_RULES).toContain('NAME IT FOR WHAT IS IN IT');
    expect(GUIDED_PREP_RULES).toContain('"onion bowl"');
    expect(GUIDED_PREP_RULES).toContain('never numbered duplicates');
  });

  it('offers merging as the other way out of a shared bowl', () => {
    // Two jobs into one bowl is usually one job that got split — the rules already
    // say things used together prep together, so the fix is not always a new name.
    expect(GUIDED_PREP_RULES).toContain('they are ONE JOB');
  });

  it('refuses a bare adverb where the method depends on a dimension', () => {
    // "Finely slice the red onion" is what real plans came back with under the old
    // wording ("Say the size, shape or state the method depends on"). Someone who
    // needs a guided plan cannot calibrate "finely" — that is precisely why they
    // are reading it.
    expect(GUIDED_PREP_RULES).toContain('GIVE THE MEASUREMENT');
    expect(GUIDED_PREP_RULES).toContain('"slice into 2mm half-moons", NOT "finely slice"');
    expect(GUIDED_PREP_RULES).toContain('A bare adverb');
  });

  it('keeps the cut size from being read as a quantity', () => {
    // Both rules sit in the same bullet, so without this the model can read "NO
    // QUANTITIES" as a licence to drop the 2mm it was just told to give.
    expect(GUIDED_PREP_RULES).toContain('A cut size is NOT a quantity');
    expect(GUIDED_PREP_RULES).toContain('never about how big you cut it');
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

  it('requires a container the prep list actually fills, copied verbatim', () => {
    // `prepEntryForContainer` in @salt/domain folds case and whitespace and NOTHING
    // else, deliberately — a looser match would nest the wrong bowl's contents into
    // a step AND subtract them from that step's loose ingredients. So the name has
    // to arrive right, and the model has to be told what a wrong one costs.
    expect(GUIDED_STEP_NOTE_RULES).toContain('one the PREP LIST ACTUALLY FILLS');
    expect(GUIDED_STEP_NOTE_RULES).toContain('COPIED VERBATIM');
    expect(GUIDED_STEP_NOTE_RULES).toContain('character for character');
    expect(GUIDED_STEP_NOTE_RULES).toContain('can no longer show the cook its contents');
  });

  it('illustrates the container with the SAME string the prep rules do', () => {
    // The defect this pair was written to close: the prep rules used to illustrate a
    // container as "small bowl" while this one illustrated the very same bowl as
    // "the small bowl" — one word apart, and no match. The prompt was teaching the
    // drift. If either example is ever reworded, both must move together.
    expect(GUIDED_PREP_RULES).toContain('"onion bowl"');
    expect(GUIDED_STEP_NOTE_RULES).toContain(
      'A job that says "onion bowl" is written here as "onion bowl"',
    );
    expect(GUIDED_STEP_NOTE_RULES).toContain('NOT "the onion bowl"');
  });

  it('confines check-ins to timed steps, strictly inside the timer', () => {
    // Phase 3 arms these off the step's own timer, so a check-in at or past the end
    // is a reminder that can never fire.
    expect(GUIDED_STEP_NOTE_RULES).toContain('ONLY on a step that already carries a timer');
    expect(GUIDED_STEP_NOTE_RULES).toContain('MUST BE LESS than the timer');
  });

  it('asks for a look-ahead on EVERY step that has one after it', () => {
    // Issue #769. The rest of this bullet list is "leave it null unless the recipe
    // left something unsaid"; `lookahead` inverts that, because it is not filling a
    // gap — it is the step handing over to the next one. The opening clause had to
    // change with it, and the two must not drift back apart: an entry emitted "only
    // for a step that genuinely needs one" is a plan where most steps preview as
    // nothing.
    expect(GUIDED_STEP_NOTE_RULES).toContain('Emit an entry for EVERY step');
    expect(GUIDED_STEP_NOTE_RULES).toContain(
      'Fill this in for EVERY step that HAS a step after it',
    );
    expect(GUIDED_STEP_NOTE_RULES).toContain('ONE SHORT CLAUSE');
  });

  it('states the DIRECTION of the look-ahead unmistakably', () => {
    // The one that shipped wrong. It is written on the step the cook is STANDING ON
    // and describes the step AFTER it. When the reader and the prompt disagreed
    // about this, the cook got a correct step number over the wrong sentence, the
    // whole way down a recipe — which reads as authoritative and is worse than no
    // panel at all.
    expect(GUIDED_STEP_NOTE_RULES).toContain('saying what the NEXT step does');
    expect(GUIDED_STEP_NOTE_RULES).toContain('READ THE DIRECTION CAREFULLY');
    expect(GUIDED_STEP_NOTE_RULES).toContain('the entry for step 3 previews step 4');
  });

  it('refuses a look-ahead on the last step', () => {
    // Asking for one on every step invites "everything is ready" on the final one,
    // which previews nothing — there is no step for it to be about. Observed in the
    // first plan written against this prompt.
    expect(GUIDED_STEP_NOTE_RULES).toContain('null on the LAST step');
  });

  it('keeps the look-ahead a heads-up rather than a second copy of the step', () => {
    expect(GUIDED_STEP_NOTE_RULES).toContain('it is a heads-up, not an instruction');
    expect(GUIDED_STEP_NOTE_RULES).toContain("Do NOT copy the next step's text");
  });

  it('hangs get-ahead on the step whose spare time it uses, not on the one before', () => {
    // Why this direction is the right one rather than merely the one the model
    // picked: an oven wanted at step 5 has to go on the ten-minute sauté at step 1.
    // Written one step before the one that needs it, a fifteen-minute preheat is
    // already late — the other arrangement could not express this at all.
    expect(GUIDED_STEP_NOTE_RULES).toContain('should be started NOW, during this one');
    expect(GUIDED_STEP_NOTE_RULES).toContain('the step whose SPARE TIME it uses');
    expect(GUIDED_STEP_NOTE_RULES).toContain('belongs on the ten-minute sauté at step 1');
  });

  it('confines get-ahead to a genuine lead time', () => {
    // The field earns the panel only when the answer is real: something that takes
    // minutes to come good on its own. A manufactured one sends the cook away from a
    // pan they are supposed to be watching, which is worse than saying nothing.
    expect(GUIDED_STEP_NOTE_RULES).toContain('genuine LEAD TIME');
    expect(GUIDED_STEP_NOTE_RULES).toContain('null for almost every step');
  });
});
