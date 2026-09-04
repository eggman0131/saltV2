/**
 * Source guard: no web-pwa component declares a canned prompt (issue #934).
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
 * app's source off disk through a repo-root escape, which is an
 * `apps/cloud-functions` → `apps/web-pwa` dependency that CLAUDE.md hard rule 6
 * forbids and that no gate could see: `readFileSync` of a path string is not an
 * edge in the import graph `lint`, `typecheck` and `depcruise` reason about.
 * A test reading its own app's source is in-app and needs no escape.
 *
 * The other half of #934's guard — that `STEP_RULES` and `REFRESH_PROMPT` both
 * contain the one shared statement, and that only `stepPolicy.ts` declares it —
 * stays in that cloud-functions test, because it is the only package that can
 * import both registers at once.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The scan surface is WALKED, never listed (UT-E1). Every `.svelte` file
 *    under `src` is read. The previous version named one file, so the exact
 *    regression — a second component growing its own `const REFRESH_PROMPT` —
 *    passed it green.
 *  - The walk asserts what it found (UT-E2): a floor on the component count,
 *    components outside `routes/` so a re-narrowing to one directory fails
 *    loudly, and the recipe page itself, which the positive assertions below
 *    are then run against — found BY the walk, not by a path constant.
 *  - The matchers are exercised against a synthetic violation and a near-miss
 *    below, so a regex broken by a later edit fails there rather than passing
 *    everything (UT-E2).
 *  - Assertions are on STRUCTURE — a `const NAME =` declaration, an import
 *    specifier — never on a sentence out of a prompt (UT-E3).
 *  - The recipe page is also asserted to still REFERENCE both prompts: one that
 *    dropped them entirely would satisfy every negative assertion and have
 *    broken both menu items.
 *
 * ── The honest boundary: what a green run here does NOT prove ────────────────
 *
 *  1. It sees a literal `const NAME =` declaration in a `.svelte` file under
 *     `apps/web-pwa/src`, and nothing else. A PARAPHRASE — a component that
 *     invents its own kitchen-optimising sentence under a different identifier —
 *     is invisible, as is a prompt assembled by a helper, a prompt in a `.ts`
 *     module, and anything outside that directory.
 *  2. Comments are NOT stripped, so a commented-out declaration counts as one.
 *     That is deliberate rather than an oversight: Svelte carries three comment
 *     syntaxes plus template interpolation, and a half-correct stripper that
 *     swallowed a real declaration would be the worse failure. A canned prompt
 *     commented out in a component is a copy waiting to be uncommented anyway.
 *  3. It asserts AT LEAST ONE component reaches the prompts (the recipe page),
 *     not exactly one. A second legitimate surface — the chat drawer already
 *     sends prompts — must be free to arrive without reddening this file. What
 *     is forbidden is declaring one, not using one.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every `.svelte` file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.svelte') ? [full] : [];
  });
}

interface Component {
  readonly path: string;
  readonly code: string;
}

const components: Component[] = walk(srcDir).map((path) => ({
  path: relative(srcDir, path).split(sep).join('/'),
  code: readFileSync(path, 'utf8'),
}));

const RECIPE_PAGE = 'routes/recipes/RecipeViewPage.svelte';
const DECLARES_REFRESH = /const\s+REFRESH_PROMPT\s*=/;
const DECLARES_OPTIMISE = /const\s+OPTIMISE_FOR_KITCHEN_PROMPT\s*=/;

const recipePage = components.find((c) => c.path === RECIPE_PAGE);

describe('no policy prose is left in the Svelte components (#934 Done when)', () => {
  it('walks the whole src tree, not one named page (the pre-#1250 blind spot)', () => {
    // Three independent floors, so neither a collapsed walk nor a rename can
    // leave this suite quietly asserting nothing over an empty set.
    expect(components.length).toBeGreaterThan(50);
    expect(
      components.filter((c) => !c.path.startsWith('routes/')).length,
      'no component found outside src/routes — the scan has narrowed to one directory',
    ).toBeGreaterThan(0);
    expect(recipePage, `${RECIPE_PAGE} not found by the walk — has the page moved?`).toBeDefined();
  });

  it('no component declares REFRESH_PROMPT or OPTIMISE_FOR_KITCHEN_PROMPT', () => {
    const offenders = components
      .filter((c) => DECLARES_REFRESH.test(c.code) || DECLARES_OPTIMISE.test(c.code))
      .map((c) => c.path);
    expect(
      offenders,
      `these components declare a canned prompt of their own: ${offenders.join(', ')}. ` +
        `Both prompts live in @salt/domain/prompts (#934) — a second copy states the ` +
        `step policy in words that share no substring with the first, so nothing greps ` +
        `them and nothing type-checks them apart.`,
    ).toEqual([]);
  });

  it('the recipe page still reaches both prompts through the shared subpath', () => {
    // Scoped to the page the walk found, not to a path string. A component that
    // dropped the prompts entirely would satisfy every negative assertion above
    // and have broken both ⋮ menu items.
    const page = recipePage?.code ?? '';
    expect(page).toContain("from '@salt/domain/prompts'");
    expect(page).toContain('OPTIMISE_FOR_KITCHEN_PROMPT');
    expect(page).toContain('REFRESH_PROMPT');
  });

  it('would catch a re-declared prompt — the matchers are exercised', () => {
    expect('  const REFRESH_PROMPT = `Write this recipe out again`;').toMatch(DECLARES_REFRESH);
    expect('  const OPTIMISE_FOR_KITCHEN_PROMPT = `Tighten this up`;').toMatch(DECLARES_OPTIMISE);
    // A near-miss: importing or sending the constant is not declaring it.
    expect("  import { REFRESH_PROMPT } from '@salt/domain/prompts';").not.toMatch(
      DECLARES_REFRESH,
    );
    expect('  send(OPTIMISE_FOR_KITCHEN_PROMPT);').not.toMatch(DECLARES_OPTIMISE);
  });
});
