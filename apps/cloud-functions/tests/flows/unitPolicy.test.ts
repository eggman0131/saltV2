/**
 * Source guard: the reader-facing unit policy is stated once (issue #934).
 *
 * The companion to `stepPolicy.test.ts`, for the second of the four policies this
 * issue unified — and the one that had actually drifted into a contradiction
 * rather than merely a duplicate. `chefChat` asked for `"½ tsp salt (3 g)"`;
 * `parseRecipeIngredients` produces `"2g whole black peppercorns (1 tsp)"`. Both
 * cannot be right, and nothing could see the disagreement, because two prompts
 * stating one policy in different words share no substring.
 *
 * The composed-prompt assertions live where the harnesses already are
 * (`chefChat.units.test.ts`, `parseRecipeIngredients.test.ts`). What is pinned
 * HERE is the property those cannot see: neither consumer carries a second copy
 * of the sentence, and the two halves of the data-loss fix are both present.
 *
 * ── The data-loss pair, and why it is asserted as a pair ────────────────────
 *
 * Flipping the chef to metric-first means a chat line reaches the parser ALREADY
 * IN GRAMS, and the parser is correctly told to emit `displayText: null` for an
 * already-metric source. On its own the flip therefore strips the spoon measure
 * from every chat-authored recipe. Two clauses stop that — the librarian's
 * `'preserve'` branch carrying the chef's bracket into `rawText`, and the
 * parser's rule lifting that bracket back out — and EITHER ONE ALONE loses the
 * measure. So they are asserted together: a future edit that deletes one has to
 * fail here rather than quietly halving the fix.
 *
 * ── The honest boundary ────────────────────────────────────────────────────
 *
 *  1. The 3 tbsp cap is a PROMPT INSTRUCTION, not a post-parse clamp. Nothing
 *     re-checks `displayText` after the model returns it, so what is enforced is
 *     that every site able to produce a bracket is told the bound — not that no
 *     bracket above 3 tbsp can ever be stored.
 *  2. A paraphrase invented in a file this test does not read is invisible. That
 *     is the defect class the issue is about, and no mechanical check sees it;
 *     what is pinned is that the KNOWN consumers compose the shared statement.
 *  3. Nothing here proves what a model does with the prompt. A cloud session has
 *     no AI keys; the round trip is a manual staging check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { READER_UNIT_PRINCIPLE } from '@salt/domain/prompts';
import { recipeFieldRules } from '../../src/flows/recipeFieldRules.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const DECLARATION_SRC = 'packages/domain/src/prompts/unitPolicy.ts';
const CHEF_SRC = 'apps/cloud-functions/src/flows/chefChat.ts';
const PARSER_SRC = 'apps/cloud-functions/src/flows/parseRecipeIngredients.ts';
const FIELD_RULES_SRC = 'apps/cloud-functions/src/flows/recipeFieldRules.ts';

describe('the unit policy is declared once and interpolated', () => {
  it('lives in @salt/domain/prompts and nowhere else', () => {
    expect(read(DECLARATION_SRC)).toContain(READER_UNIT_PRINCIPLE);
    for (const consumer of [CHEF_SRC, PARSER_SRC]) {
      expect(read(consumer)).not.toContain(READER_UNIT_PRINCIPLE);
      expect(read(consumer)).toContain('${READER_UNIT_PRINCIPLE}');
    }
  });

  it('is NOT interpolated into MEASURE_RULES — the boundary is deliberate', () => {
    // The trap this issue must not walk into. MEASURE_RULES governs the `rawText`
    // the librarian and the extractors write, and it says the OPPOSITE about a
    // spoon measure: leave it verbatim, do not convert, because the stage that
    // converts is parseRecipeIngredients and converting early DELETES the bracket
    // instead of moving it. That is how imports lost their spoon measures once
    // already (see the MEASURE_RULES header). A future tidy-up that "finishes the
    // job" by interpolating the reader-facing rule here fails this test.
    expect(read(FIELD_RULES_SRC)).not.toContain('${READER_UNIT_PRINCIPLE}');
    expect(read(FIELD_RULES_SRC)).not.toContain(READER_UNIT_PRINCIPLE);
    expect(recipeFieldRules({ measures: 'preserve' })).not.toContain(READER_UNIT_PRINCIPLE);
    expect(recipeFieldRules({ measures: 'metricate' })).not.toContain(READER_UNIT_PRINCIPLE);
  });

  it('would catch a re-typed copy — the matchers are exercised', () => {
    // UT-E2: the assertions above are `not.toContain`, which would also pass on an
    // unreadable file or an empty constant. Prove the matcher fires.
    expect(`const X = \`${READER_UNIT_PRINCIPLE}\`;`).toContain(READER_UNIT_PRINCIPLE);
    expect(READER_UNIT_PRINCIPLE.length).toBeGreaterThan(100);
    // A near-miss: naming the constant is not restating it.
    expect('${READER_UNIT_PRINCIPLE}').not.toContain(READER_UNIT_PRINCIPLE);
  });
});

describe('the chef flip and the parser rule ship as one', () => {
  it("carries the chef's bracket through the librarian's 'preserve' clause", () => {
    // Half one. Without this the chef's "(½ tsp)" never reaches rawText and the
    // parser has nothing to lift, whatever the parser is told.
    const preserve = recipeFieldRules({ measures: 'preserve' });
    expect(preserve).toContain('a spoon measure the chef wrote in brackets AFTER a metric amount');
    expect(preserve).toContain('3 g salt (½ tsp)');
    expect(preserve).toContain('copy that bracket through exactly as written');
  });

  it("leaves the 'metricate' branch alone", () => {
    // An importer's line never carries a chef-written bracket, and the issue's
    // must-not-touch list names this branch. The clause is 'preserve'-only, which
    // also keeps the one-line diff between the two renderings that
    // recipeFieldRules.test.ts pins.
    const metricate = recipeFieldRules({ measures: 'metricate' });
    expect(metricate).not.toContain('a spoon measure the chef wrote in brackets AFTER a metric');
  });

  it('lifts that bracket back out in the parser prompt', () => {
    // Half two, and the 3 tbsp bound that makes the cap a rule rather than a claim.
    // Asserted on the source rather than the composed prompt because the composed
    // assertions live in parseRecipeIngredients.test.ts, next to their harness.
    const parser = read(PARSER_SRC);
    expect(parser).toContain('that BRACKET IS the displayText');
    expect(parser).toContain('do NOT treat the line as already-metric below');
    expect(parser).toContain('but ONLY up');
    expect(parser).toContain('to 3 tbsp');
    // ...and the already-metric null rule now says "AND carries no bracketed spoon
    // measure", which is the clause that stops the two rules cancelling out.
    expect(parser).toContain('already in g, kg, ml, or l AND carries no bracketed spoon measure');
  });
});
