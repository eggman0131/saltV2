/**
 * Source guard: the step policy is stated once (issue #934).
 *
 * `STEP_RULES` (the field-list register, read by the librarian and both
 * extractors) and `REFRESH_PROMPT` (the conversational register, sent from the
 * recipe page's ⋮ menu) each told the model how to split a step, in their own
 * words, in two packages that cannot import one another. Two prompts stating one
 * policy in different words share NO SUBSTRING: nothing greps them, nothing
 * type-checks them, and `depcruise` sees two unrelated string literals. That is
 * why the fix needed a guard as much as it needed a shared constant — the copy
 * comes back as a reworded sentence, not as a duplicated identifier.
 *
 * Per CLAUDE.md Hard rule 12, "stated once" is asserted here rather than in a
 * header comment nothing enforces.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The sentence is IMPORTED from `@salt/domain/prompts`, never restated
 *    (UT-E1). Reword the constant and every assertion below moves with it.
 *  - Both consumers are asserted to CONTAIN it (UT-E2), so a prompt that stops
 *    interpolating fails here — which is the exact failure mode, since a prompt
 *    that drops the interpolation is still a valid prompt and a valid type.
 *  - The two source files are read and asserted to interpolate rather than
 *    re-type (UT-E2). Editing the sentence in place inside a consumer, instead
 *    of in the constant, is the second way this regresses.
 *
 * ── Where the component half lives ───────────────────────────────────────────
 *
 * #934's other "Done when" — that no web-pwa component re-declares a canned
 * prompt — is pinned in `apps/web-pwa/tests/stepPolicyPrompts.test.ts`. It was
 * asserted here, by reading the component off disk through a repo-root path,
 * which is the cross-app reach CLAUDE.md hard rule 6 forbids and which no gate
 * can see (a `readFileSync` is not an edge in the import graph). It moved into
 * the app that owns the file it reads (#1250).
 *
 * ── The honest boundary: what a green run here does NOT prove ────────────────
 *
 *  1. It cannot see a PARAPHRASE added elsewhere. A fourth prompt that invents
 *    its own step-splitting sentence in a file this test does not read is
 *    invisible, and no mechanical check can see it either — that is the defect
 *    class the issue is about. What is pinned is that the two KNOWN consumers
 *    compose the shared statement and do not carry a second copy of it.
 *  2. It says nothing about what a model does with the prompt. No test in this
 *    repo can: a cloud session has no AI keys, which is why prompt policy here
 *    is pinned by text assertions in the first place.
 *  3. It does not pin the LABELS (`ONE COHERENT OPERATION PER STEP.` and
 *    `One coherent operation per step.`). Those are deliberately per-register
 *    and free to differ; `stepRules.test.ts` pins the shouted one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ONE_OPERATION_PER_STEP_PRINCIPLE, REFRESH_PROMPT } from '@salt/domain/prompts';
import { STEP_RULES } from '../../src/flows/stepRules.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const STEP_RULES_SRC = 'apps/cloud-functions/src/flows/stepRules.ts';
const CHAT_PROMPTS_SRC = 'packages/domain/src/prompts/recipeChatPrompts.ts';
const DECLARATION_SRC = 'packages/domain/src/prompts/stepPolicy.ts';

describe('the step policy reaches both registers from one statement', () => {
  it('is present in the field-list prompt and the chat turn alike', () => {
    expect(STEP_RULES).toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
    expect(REFRESH_PROMPT).toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
  });

  it('is declared in exactly one source file, and interpolated by the other two', () => {
    // The regression: someone edits the sentence where they can see it — inside
    // STEP_RULES or inside REFRESH_PROMPT — instead of in the constant. The prompt
    // still compiles, still lints, still reads correctly, and the two registers
    // have quietly stopped agreeing.
    expect(read(DECLARATION_SRC)).toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
    for (const consumer of [STEP_RULES_SRC, CHAT_PROMPTS_SRC]) {
      expect(read(consumer)).not.toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
      expect(read(consumer)).toContain('${ONE_OPERATION_PER_STEP_PRINCIPLE}');
    }
  });

  it('would catch a re-typed copy — the matcher is exercised, not assumed', () => {
    // UT-E2. The assertion above is a `not.toContain` and would pass on a file it
    // failed to read or on a constant that had become the empty string, so prove
    // both matchers fire on a synthetic violation and stay quiet on a near-miss.
    const violation = `const X = \`...${ONE_OPERATION_PER_STEP_PRINCIPLE}...\`;`;
    expect(violation).toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
    expect(ONE_OPERATION_PER_STEP_PRINCIPLE.length).toBeGreaterThan(100);
    // A near-miss: the label alone is NOT the policy, and must not read as a copy.
    expect('ONE COHERENT OPERATION PER STEP.').not.toContain(ONE_OPERATION_PER_STEP_PRINCIPLE);
  });
});
