/**
 * Source guard: no web-pwa component re-declares a canned prompt (issue #934).
 *
 * `REFRESH_PROMPT` and `OPTIMISE_FOR_KITCHEN_PROMPT` are the two conversational
 * prompts the recipe page's ⋮ menu sends. They used to be typed out in the
 * component, which is how the step policy came to be stated twice in words that
 * share no substring — nothing greps two paraphrases, nothing type-checks them.
 * #934 moved both into `@salt/domain/prompts`; this is the "Done when" of that
 * fix, pinned rather than asserted in a comment (CLAUDE.md hard rule 12).
 *
 * ── Why this lives here and not in apps/cloud-functions ──────────────────────
 *
 * It used to. `apps/cloud-functions/tests/flows/stepPolicy.test.ts` read this
 * component off disk through a repo-root escape, which is an
 * `apps/cloud-functions` → `apps/web-pwa` dependency that CLAUDE.md hard rule 6
 * forbids and that no gate could see: `readFileSync` of a path string is not an
 * edge in the import graph `lint`, `typecheck` and `depcruise` reason about.
 * A test reading a component in its own app is in-app and needs no escape.
 *
 * The other half of #934's guard — that `STEP_RULES` and `REFRESH_PROMPT` both
 * contain the one shared statement, and that only `stepPolicy.ts` declares it —
 * stays in that cloud-functions test, because it is the only package that can
 * import both registers at once.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The assertions are on STRUCTURE — a `const NAME =` declaration, an import
 *    specifier — never on a sentence out of a prompt (UT-E3).
 *  - The `not.toMatch` matchers are exercised against a synthetic violation and
 *    a near-miss below, so a regex that stopped matching fails there rather than
 *    passing everything (UT-E2).
 *  - The component is also asserted to still REFERENCE both prompts: one that
 *    dropped them entirely would satisfy every negative assertion and have
 *    broken both menu items.
 *
 * ── The honest boundary: what a green run here does NOT prove ────────────────
 *
 * The scan surface is ONE named file. A second component that grew its own
 * `const REFRESH_PROMPT = …` — the exact regression — passes this green. That
 * is UT-E1's target and it is fixed in the next phase of #1250; it is stated
 * here rather than left implied.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RECIPE_PAGE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/routes/recipes/RecipeViewPage.svelte',
);

describe('no policy prose is left in the Svelte component (#934 Done when)', () => {
  it('declares neither canned prompt and imports both from the shared subpath', () => {
    const page = readFileSync(RECIPE_PAGE, 'utf8');
    expect(page).not.toMatch(/const\s+REFRESH_PROMPT\s*=/);
    expect(page).not.toMatch(/const\s+OPTIMISE_FOR_KITCHEN_PROMPT\s*=/);
    expect(page).toContain("from '@salt/domain/prompts'");
    // Still sent, though — a component that dropped the prompts entirely would
    // pass every assertion above and have broken both menu items.
    expect(page).toContain('OPTIMISE_FOR_KITCHEN_PROMPT');
    expect(page).toContain('REFRESH_PROMPT');
  });

  it('would catch a re-declared prompt — the matcher is exercised', () => {
    expect('  const REFRESH_PROMPT = `Write this recipe out again`;').toMatch(
      /const\s+REFRESH_PROMPT\s*=/,
    );
    // A near-miss: importing or sending the constant is not declaring it.
    expect("  import { REFRESH_PROMPT } from '@salt/domain/prompts';").not.toMatch(
      /const\s+REFRESH_PROMPT\s*=/,
    );
  });
});
