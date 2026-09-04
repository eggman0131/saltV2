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
 *  - The matchers are exercised against synthetic violations and near-misses
 *    below — including the typed, `let`, `var` and destructured spellings a
 *    plain `/const\s+NAME\s*=/` used to miss — so a regex broken or narrowed by
 *    a later edit fails there rather than passing everything (UT-E2).
 *  - Assertions are on STRUCTURE — a `const`/`let`/`var` declaration, an import
 *    specifier, a `chat.send` call shape — never on a sentence out of a prompt,
 *    and never a bare substring a comment could satisfy on its own (UT-E3).
 *  - The recipe page is also asserted to still REFERENCE both prompts, via the
 *    same structural shapes: one that dropped the import binding and the
 *    `chat.send` call would fail here even though the comments beside those
 *    call sites still name both identifiers. That deletion is exercised
 *    directly, not just asserted about.
 *
 * ── The honest boundary: what a green run here does NOT prove ────────────────
 *
 *  1. It sees a `const`/`let`/`var` declaration of the exact identifier —
 *     however typed or destructured — in a `.svelte` file under
 *     `apps/web-pwa/src`, and nothing else. A PARAPHRASE — a component that
 *     invents its own kitchen-optimising sentence under a different identifier —
 *     is invisible, as is a prompt assembled by a helper, a prompt in a `.ts`
 *     module, a second declarator sharing a `const` statement with one that
 *     already carries an `=`, and anything outside that directory.
 *  2. Comments are NOT stripped, and that cuts both ways. A commented-out
 *     declaration counts as one — a false positive on the negative scan. The
 *     same non-stripping lets the positive scan below pass on prose alone
 *     UNLESS the check is structural: a bare `toContain` of an identifier is
 *     satisfied by the comments beside each call site (`RecipeViewPage.svelte`
 *     lines ~906 and ~1015) even after the real import binding and `chat.send`
 *     call are deleted — a false negative, and the one with a live falsifier,
 *     which is why the positive checks below match an import specifier and a
 *     call shape rather than an identifier substring. Not stripping is still
 *     deliberate rather than an oversight: Svelte carries three comment
 *     syntaxes plus template interpolation, and a half-correct stripper that
 *     swallowed a real declaration would be the worse failure. A comment that
 *     itself echoes the exact import or `chat.send` syntax — not just the
 *     identifier — would still slip both directions; nothing here strips text.
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
// `[^=\n]*?` between the keyword and the name (rather than requiring plain
// whitespace) is what closes a type annotation and a destructured binding
// alike — both stop at the first `const`/`let`/`var` on the line, so a
// multi-declarator statement whose earlier declarator carries its own `=`
// is outside what this pins. `\b...\b` keeps `REFRESH_PROMPT_LABEL` a
// non-match, exercised below alongside the forms this is meant to catch.
const DECLARES_REFRESH = /\b(?:const|let|var)\b[^=\n]*?\bREFRESH_PROMPT\b[^=\n]*=/;
const DECLARES_OPTIMISE = /\b(?:const|let|var)\b[^=\n]*?\bOPTIMISE_FOR_KITCHEN_PROMPT\b[^=\n]*=/;

// A component reaches a prompt only by importing it from the shared subpath
// and passing it to `chat.send`. Both are STRUCTURAL — an import specifier
// and a call shape — never a bare identifier substring, because a substring
// check is satisfied by the prose comments beside each call site below.
const IMPORTS_REFRESH =
  /import\s*\{[^}]*\bREFRESH_PROMPT\b[^}]*\}\s*from\s*['"]@salt\/domain\/prompts['"]/;
const IMPORTS_OPTIMISE =
  /import\s*\{[^}]*\bOPTIMISE_FOR_KITCHEN_PROMPT\b[^}]*\}\s*from\s*['"]@salt\/domain\/prompts['"]/;
const SENDS_REFRESH = /chat\.send\([^)]*\bREFRESH_PROMPT\b[^)]*\)/;
const SENDS_OPTIMISE = /chat\.send\([^)]*\bOPTIMISE_FOR_KITCHEN_PROMPT\b[^)]*\)/;

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
    // Scoped to the page the walk found, not to a path string. Both checks are
    // structural (an import binding, a `chat.send` call) rather than a bare
    // substring, because the page also NAMES both identifiers in prose comments
    // beside each call site — a substring check is satisfied by the comment
    // alone and would not move if the real declaration and call site were both
    // deleted. Simulating exactly that deletion (import binding, the
    // `chat.send` call and the starter entry, comments left in place) is what
    // the matcher-exercise `it` below pins.
    const page = recipePage?.code ?? '';
    expect(page).toMatch(IMPORTS_OPTIMISE);
    expect(page).toMatch(IMPORTS_REFRESH);
    expect(page).toMatch(SENDS_OPTIMISE);
    expect(page).toMatch(SENDS_REFRESH);
  });

  it('would catch a re-declared prompt — the matchers are exercised, including the spellings that used to slip through', () => {
    // The forms a normal author writes in a `<script lang="ts">` component: a
    // plain declaration, a type annotation (the ordinary spelling here), `let`,
    // `var`, and a destructured rebinding. All five used to slip past
    // `/const\s+NAME\s*=/`; each is pinned here so a future narrowing of the
    // regex fails on this line rather than passing everything.
    expect('  const REFRESH_PROMPT = `Write this recipe out again`;').toMatch(DECLARES_REFRESH);
    expect('  const REFRESH_PROMPT: string = `Write this recipe out again`;').toMatch(
      DECLARES_REFRESH,
    );
    expect('  let REFRESH_PROMPT = `Write this recipe out again`;').toMatch(DECLARES_REFRESH);
    expect('  var REFRESH_PROMPT = `Write this recipe out again`;').toMatch(DECLARES_REFRESH);
    expect('  const { REFRESH_PROMPT } = prompts;').toMatch(DECLARES_REFRESH);
    expect('  const OPTIMISE_FOR_KITCHEN_PROMPT: string = `Tighten this up`;').toMatch(
      DECLARES_OPTIMISE,
    );
    // Near-misses: importing or sending the constant is not declaring it, and
    // a longer name that merely starts with the same word is not a match.
    expect("  import { REFRESH_PROMPT } from '@salt/domain/prompts';").not.toMatch(
      DECLARES_REFRESH,
    );
    expect('  send(OPTIMISE_FOR_KITCHEN_PROMPT);').not.toMatch(DECLARES_OPTIMISE);
    expect('  const REFRESH_PROMPT_LABEL = `Refresh`;').not.toMatch(DECLARES_REFRESH);
  });

  it('the reaches-both-prompts checks are structural, not a comment away from vacuous', () => {
    // Exercises IMPORTS_*/SENDS_* directly against the exact shape of the
    // regression the reviewer of #1253 simulated: the identifiers survive only
    // in prose, everything live is gone.
    const commentOnly =
      '// Sends OPTIMISE_FOR_KITCHEN_PROMPT as an ordinary user turn\n' +
      '// Sends REFRESH_PROMPT as an ordinary user turn\n' +
      "import { push } from 'svelte-spa-router';\n";
    expect(commentOnly).not.toMatch(IMPORTS_OPTIMISE);
    expect(commentOnly).not.toMatch(IMPORTS_REFRESH);
    expect(commentOnly).not.toMatch(SENDS_OPTIMISE);
    expect(commentOnly).not.toMatch(SENDS_REFRESH);
    // The real shapes still match.
    expect(
      "import { OPTIMISE_FOR_KITCHEN_PROMPT, REFRESH_PROMPT } from '@salt/domain/prompts';",
    ).toMatch(IMPORTS_OPTIMISE);
    expect(
      "import { OPTIMISE_FOR_KITCHEN_PROMPT, REFRESH_PROMPT } from '@salt/domain/prompts';",
    ).toMatch(IMPORTS_REFRESH);
    expect('await chat.send(session, OPTIMISE_FOR_KITCHEN_PROMPT);').toMatch(SENDS_OPTIMISE);
    expect('if (!(await chat.send(session, REFRESH_PROMPT))) return;').toMatch(SENDS_REFRESH);
  });
});
