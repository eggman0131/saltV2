import { describe, it, expect } from 'vitest';
import {
  ONE_OPERATION_PER_STEP_PRINCIPLE,
  OPTIMISE_FOR_KITCHEN_PROMPT,
  REFRESH_PROMPT,
} from '../../src/prompts/index.js';

// Issue #934. `REFRESH_PROMPT` and `STEP_RULES` (apps/cloud-functions) ask for the
// same step splitting in two registers. The half of the pin that proves neither
// side re-types the sentence lives in `apps/cloud-functions/tests/flows/
// stepPolicy.test.ts` — it is the only place that can hold both constants at once,
// and it may read source files, which a test under `packages/domain` may not (the
// `node:fs` ban applies to the whole package, tests included). This file pins what
// the constants themselves say.

describe('ONE_OPERATION_PER_STEP_PRINCIPLE', () => {
  it('composes into REFRESH_PROMPT verbatim', () => {
    expect(REFRESH_PROMPT).toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
  });

  it('carries no label, bullet or trailing newline of its own', () => {
    // Both consumers supply their own label — the field list shouts it, the chat
    // turn does not — and both interpolate mid-paragraph. A leading "- " would
    // split the steps bullet of every authoring prompt; a newline would break the
    // chat paragraph in two.
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE.startsWith('- ')).toBe(false);
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE).not.toContain('\n');
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE).not.toContain('ONE COHERENT OPERATION PER STEP');
  });

  it('states the three things a split turns on', () => {
    // What the two prompts each used to say in their own words: what a step is,
    // what stays together, and what starts a new one. Reword any of these and both
    // registers move together, which is the whole point of the constant.
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE).toContain(
      'one thing the cook does before looking back at the recipe',
    );
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE).toContain(
      'Actions that happen in a single go stay together',
    );
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE).toContain(
      'a change of station, a wait, or a distinct process starts a new step',
    );
  });

  it('splits with a plain sentence-case clause, not the old shouted label (#1196)', () => {
    // Before #934 unified the two registers, the field-list prompt shouted
    // "SPLIT any instruction...". The migrated principle deliberately uses
    // sentence case instead, for the prose it now sits inside — pin the exact
    // casing so a "tidy" back to the old register (or a silent re-shout) is
    // caught here rather than shipping unasserted. `stepRules.test.ts` pins the
    // OTHER label this file interpolates into (`ONE COHERENT OPERATION PER
    // STEP`), which is deliberately still shouted and untouched by this change.
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE).toContain(
      'Split any instruction that bundles several operations into consecutive steps.',
    );
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE).not.toContain('SPLIT any instruction');
  });
});

describe('the canned chef turns', () => {
  it('still carry the five loads REFRESH_PROMPT was written for (#890)', () => {
    // Not a paraphrase check — these are the clauses the header comment enumerates,
    // and #934 moved this prompt between packages with no licence to change what it
    // asks for. Each assertion is one numbered load.
    expect(REFRESH_PROMPT).toContain('Give me the complete recipe, not a list of changes');
    expect(REFRESH_PROMPT).toContain('State the servings, and state the timings');
    expect(REFRESH_PROMPT).toContain('Keep it the same dish');
    expect(REFRESH_PROMPT).toContain('say which one you changed and why');
    expect(REFRESH_PROMPT).toContain('Leave my own notes alone');
    // ...and the step load, now composed rather than stated.
    expect(REFRESH_PROMPT).toContain('One coherent operation per step.');
  });

  it('keeps Optimise a relocation, not a deduplication', () => {
    // #934 deliberately did NOT manufacture a shared constant for Optimise: its
    // content is genuine per-action instruction, and inventing one to justify the
    // move would be the same drift risk in a new place. So it states the four loads
    // its header enumerates and interpolates nothing.
    expect(OPTIMISE_FOR_KITCHEN_PROMPT).toContain('Change the method only');
    expect(OPTIMISE_FOR_KITCHEN_PROMPT).toContain('Move the timings and temperatures with it');
    expect(OPTIMISE_FOR_KITCHEN_PROMPT).toContain('Be proportionate');
    expect(OPTIMISE_FOR_KITCHEN_PROMPT).toContain('Finish with a short note on what you changed');
    expect(OPTIMISE_FOR_KITCHEN_PROMPT).not.toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
  });
});
