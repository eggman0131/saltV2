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
 *    specifier, or a real reference outside that import line and outside a
 *    comment — never on a sentence out of a prompt (UT-E3). Comments are
 *    stripped before every positive check runs (see `stripComments` below), so
 *    a bare identifier left behind in a comment cannot satisfy them (#1256
 *    review, blocking 1).
 *  - The recipe page is also asserted to still REFERENCE both prompts, exercised
 *    against the REAL file with the #1253 regression's exact deletions applied
 *    to it — not a hand-written stand-in that omits the import line, the
 *    `chat.send` call and the starter entry, which is the gap a synthetic left
 *    open (#1256 review, should-fix 3).
 *
 * ── The honest boundary: what a green run here does NOT prove ────────────────
 *
 *  1. It sees a `const`/`let`/`var` declaration of the exact identifier —
 *     however typed or destructured, ON ONE LINE — in a `.svelte` file under
 *     `apps/web-pwa/src`, and nothing else. A multi-line destructure
 *     (`const {\n  REFRESH_PROMPT,\n} = prompts;`) or a declaration split
 *     across a `=` on its own line MISSES, because both `[^=\n]` classes stop
 *     at a newline. A PARAPHRASE — a component that invents its own
 *     kitchen-optimising sentence under a different identifier — is invisible
 *     too, as is a prompt assembled by a helper, a prompt in a `.ts` module, a
 *     second declarator sharing a `const` statement with one that already
 *     carries an `=`, and anything outside that directory.
 *  2. Comments are stripped before the two positive checks below run (an
 *     import specifier, a live reference) — the same `//` / `/* *\/` strip
 *     `aiTimeoutGuard.test.ts` already relies on for a TS-flavoured source
 *     tree, never Svelte's `<!-- -->` (irrelevant inside a `<script>` block).
 *     That closes the #1256 review's hole: a bare identifier comment sitting
 *     *inside* the import braces or *inside* `chat.send`'s argument list no
 *     longer satisfies either check, because the comment is gone before the
 *     regex runs. The negative scan (`DECLARES_*`, limit 1) is NOT stripped —
 *     deliberately: a commented-out declaration still counts as one, a false
 *     positive kept on purpose, because a half-correct stripper that swallowed
 *     a real declaration would be the worse failure for that side. The same
 *     non-stripping is why a prose line naming both the keyword and the
 *     identifier trips `DECLARES_*` (limit 1's neighbour, exercised below) —
 *     that is not a comment-hole, it is `DECLARES_*` reading exactly what it
 *     is defined to read. The comment-stripping itself is naive line/block
 *     matching, so a `//` inside a string literal (a URL, say) would be misread
 *     as a comment start; neither prompt's surrounding code has one today.
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
// is outside what this pins, and so is any of the above split across a
// newline: both `[^=\n]` classes forbid one, so the match is single-line
// only. `\b...\b` keeps `REFRESH_PROMPT_LABEL` a non-match, exercised below
// alongside the forms this is meant to catch — including the prose false
// positive this same widening buys (limit 2 above).
const DECLARES_REFRESH = /\b(?:const|let|var)\b[^=\n]*?\bREFRESH_PROMPT\b[^=\n]*=/;
const DECLARES_OPTIMISE = /\b(?:const|let|var)\b[^=\n]*?\bOPTIMISE_FOR_KITCHEN_PROMPT\b[^=\n]*=/;

/**
 * Strips `//` line comments and `/* *\/` block comments before every positive
 * structural check below runs — the same helper `aiTimeoutGuard.test.ts`
 * already uses for the same reason: a mention of the identifier in prose must
 * never count as the identifier being live. Never applied to `DECLARES_*`
 * above; see limit 2.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// A component reaches a prompt by importing it from the shared subpath AND
// referencing it somewhere that import line doesn't already cover — both
// STRUCTURAL, and both run against comment-stripped source, never a bare
// identifier substring on the raw file (a substring check, or an unstripped
// one, is satisfied by the prose comments beside each call site below).
const IMPORTS_REFRESH =
  /import\s*\{[^}]*\bREFRESH_PROMPT\b[^}]*\}\s*from\s*['"]@salt\/domain\/prompts['"]/;
const IMPORTS_OPTIMISE =
  /import\s*\{[^}]*\bOPTIMISE_FOR_KITCHEN_PROMPT\b[^}]*\}\s*from\s*['"]@salt\/domain\/prompts['"]/;

// Strips the shared import statement itself, so what is left is only code
// that USES an identifier, never the declaration that merely names it.
// Matching the braces non-greedily is safe here because whatever this runs
// against has already been through `stripComments`: a leftover comment
// cannot be hiding inside them by the time this pattern sees the text.
const IMPORT_STATEMENT = /import\s*\{[^}]*\}\s*from\s*['"]@salt\/domain\/prompts['"];?/g;

/**
 * True once `identifier` is used somewhere in `code` that is neither a
 * comment nor the shared import line itself.
 *
 * Deliberately not pinned to `chat.send`, unlike the version #1253 shipped.
 * The #1256 review measured that pin already false against the file it
 * asserts about: `recipeStarters`'s `{ text: OPTIMISE_FOR_KITCHEN_PROMPT }`
 * (RecipeViewPage.svelte:949) reaches the prompt without ever calling
 * `chat.send`, and extracting the send helper `handleOptimiseForKitchen` and
 * `handleRefresh` duplicate today would red a `chat.send(...)`-shaped check on
 * perfectly working code. "Used outside the import line, outside a comment"
 * covers both without widening into "matches anything": delete the real usage
 * and leave only a comment, and this still returns false, because the comment
 * is gone before the check ever runs.
 *
 * Residual, stated rather than closed: an aliased import
 * (`import { REFRESH_PROMPT as REFRESH } from ...` then using `REFRESH`) is
 * invisible to this — the identifier this function is given no longer
 * appears anywhere outside the import line. Following a rename needs a real
 * parser, which is the design fork the #1256 review's finding did not ask
 * for; this is the boundary named instead of guessed past.
 */
function reaches(code: string, identifier: RegExp): boolean {
  const live = stripComments(code).replace(IMPORT_STATEMENT, '');
  return identifier.test(live);
}
const IDENTIFIER_REFRESH = /\bREFRESH_PROMPT\b/;
const IDENTIFIER_OPTIMISE = /\bOPTIMISE_FOR_KITCHEN_PROMPT\b/;

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
    // Scoped to the page the walk found, not to a path string. Both checks run
    // against comment-stripped code, because the page also NAMES both
    // identifiers in prose comments beside each call site — an unstripped
    // check is satisfied by the comment alone and would not move if the real
    // import and reference were both deleted. The next `it` exercises exactly
    // that deletion against this same file.
    const page = recipePage?.code ?? '';
    expect(stripComments(page)).toMatch(IMPORTS_OPTIMISE);
    expect(stripComments(page)).toMatch(IMPORTS_REFRESH);
    expect(reaches(page, IDENTIFIER_OPTIMISE)).toBe(true);
    expect(reaches(page, IDENTIFIER_REFRESH)).toBe(true);
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
    // Known, stated false positive (limit 2 above): prose that names both the
    // keyword and the identifier on one line trips this scan too. Kept —
    // narrowing the widening away would also lose the destructure form above.
    expect('// the local const is gone: REFRESH_PROMPT === the shared one').toMatch(
      DECLARES_REFRESH,
    );
  });

  it('the reaches-both-prompts checks hold against the real file with the #1253 deletion applied, not a synthetic stand-in', () => {
    const original = recipePage?.code ?? '';
    const importLine =
      "import { OPTIMISE_FOR_KITCHEN_PROMPT, REFRESH_PROMPT } from '@salt/domain/prompts';";
    const sendCall = 'await chat.send(session, OPTIMISE_FOR_KITCHEN_PROMPT);';
    const starterEntry = "{ label: 'Optimise for my kitchen', text: OPTIMISE_FOR_KITCHEN_PROMPT }";
    for (const needle of [importLine, sendCall, starterEntry]) {
      expect(
        original,
        `fixture drift — "${needle}" is no longer verbatim in ${RECIPE_PAGE}; update this test`,
      ).toContain(needle);
    }

    // Exactly the #1253 regression the earlier review simulated (drop the
    // import specifier, the `chat.send` call and the starter entry), PLUS the
    // two comment shapes the #1256 review measured slipping past the old
    // structural checks: a bare identifier comment inside the import braces,
    // and inside `chat.send`'s own argument list.
    const deleted = original
      .replace(
        importLine,
        "import {\n    // OPTIMISE_FOR_KITCHEN_PROMPT went with the menu item\n    REFRESH_PROMPT,\n  } from '@salt/domain/prompts';",
      )
      .replace(
        sendCall,
        'await chat.send(\n      session,\n      // not OPTIMISE_FOR_KITCHEN_PROMPT — that one is gone\n      REFRESH_PROMPT,\n    );',
      )
      .replace(
        starterEntry,
        "{ label: 'Optimise for my kitchen', text: 'gone' /* was OPTIMISE_FOR_KITCHEN_PROMPT */ }",
      );

    expect(stripComments(deleted)).not.toMatch(IMPORTS_OPTIMISE);
    expect(reaches(deleted, IDENTIFIER_OPTIMISE)).toBe(false);
    // Refresh is untouched by any of the three deletions above.
    expect(stripComments(deleted)).toMatch(IMPORTS_REFRESH);
    expect(reaches(deleted, IDENTIFIER_REFRESH)).toBe(true);
  });

  it('reaches tolerates the ordinary shapes a legitimate refactor takes', () => {
    // A helper the two menu handlers (`handleOptimiseForKitchen`,
    // `handleRefresh`) could share instead of each duplicating
    // `await chat.send(session, OPTIMISE_FOR_KITCHEN_PROMPT)` — concrete code
    // the #1256 review measured reddening the old `chat.send`-pinned check.
    expect(reaches('await sendPrompt(OPTIMISE_FOR_KITCHEN_PROMPT);', IDENTIFIER_OPTIMISE)).toBe(
      true,
    );
    // The recipeStarters entry itself (RecipeViewPage.svelte:949) — a plain
    // object literal, never a `chat.send` call.
    expect(
      reaches(
        "{ label: 'Optimise for my kitchen', text: OPTIMISE_FOR_KITCHEN_PROMPT }",
        IDENTIFIER_OPTIMISE,
      ),
    ).toBe(true);
    // A call whose argument list itself contains a `)` before the identifier —
    // the shape a `[^)]*`-only check could never cross.
    expect(
      reaches(
        'await chat.send(session ?? (await createRecipeChat()), REFRESH_PROMPT);',
        IDENTIFIER_REFRESH,
      ),
    ).toBe(true);
    // Still false when the identifier survives only as a comment, and false
    // when it is genuinely absent.
    expect(reaches('// OPTIMISE_FOR_KITCHEN_PROMPT used to live here', IDENTIFIER_OPTIMISE)).toBe(
      false,
    );
    expect(reaches('nothing to see here', IDENTIFIER_OPTIMISE)).toBe(false);
  });
});
