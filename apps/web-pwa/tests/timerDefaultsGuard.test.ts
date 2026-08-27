/**
 * Source guard: nothing re-declares a timer default (issues #842, #994).
 *
 * `lib/timerDefaults.ts` exists because three screens can start a timer — plain
 * cook mode, guided cook and My Kitchen — and all three must offer the same
 * default and arm the same push backstop. Guided cook nonetheless shipped with
 * its own `NOTIFY_MIN_MINUTES = 1.5`, `AD_HOC_TIMER_LABEL` and
 * `AD_HOC_TIMER_MINUTES`, held in agreement by a comment asking the next author
 * to keep them identical. #994 deleted those copies in favour of the import;
 * this is what stops the next one appearing.
 *
 * The failure it prevents is SILENT. A drifted floor does not throw, does not
 * log, and does not fail a page test: a timer started from the wrong screen
 * simply, quietly, never pushes. Nothing else in CI would say so.
 *
 * ── Two halves, because drift has two shapes ─────────────────────────────────
 *
 * A file can copy a default by NAME (`const NOTIFY_MIN_MINUTES = 1.5`) or by
 * VALUE (`notify: durationMinutes >= 1.5`). Guided cook shipped BOTH: the local
 * constant, and the two bare comparisons at `main:680` and `:700` that used it.
 * The second shape declares nothing and references nothing, so a name-only guard
 * cannot see it — and it is the one `timerDefaults.ts` names as its own reason
 * for existing ("a function rather than a bare comparison at each call site").
 * Both halves are checked, and both read their subject out of the module.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The guarded identifiers are read out of `timerDefaults.ts` itself, so
 *    renaming or adding an export moves the guard with it. There is no list to
 *    maintain here (UT-E1).
 *  - The scan surface is the whole of `src`, walked — not a list of pages. A
 *    fourth screen that starts a timer is covered on the day it is written
 *    (UT-E1).
 *  - It asserts on IDENTIFIERS and on the import, never on the wording of the
 *    comments beside them and never on a line number (UT-E3). Both are things
 *    #994 itself rewrote.
 *  - Which VALUES are worth forbidding is derived too: a number qualifies by the
 *    module comparing against it, a string by being one. So a second boundary
 *    constant is covered the day it is added, and `AD_HOC_TIMER_MINUTES = 10` —
 *    a starting value nothing compares to, whose drift is visible on screen —
 *    stays out, rather than firing on every `> 10` in the app (UT-E1).
 *  - It proves it can still see (UT-E2): the walk must find the file the drift
 *    was in, the export list must be non-empty, `INLINEABLE` must have picked up
 *    both kinds, and both matchers are exercised against synthetic copies — the
 *    drift they must catch AND the near-misses they must not — so a broken regex
 *    fails here rather than passing everything or failing everywhere.
 *
 * It is a genuine source scan — it reads bytes off disk and never imports the
 * modules it checks, so no `vi.mock` can make it agree.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');
const defaultsPath = join(srcDir, 'lib/timerDefaults.ts');

/** Every source file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!entry.isFile()) return [];
    return entry.name.endsWith('.ts') || entry.name.endsWith('.svelte') ? [full] : [];
  });
}

// The three comment forms a `.ts` or `.svelte` file can carry, each as its opener
// and what closes it. A line comment closes at the newline, which is kept.
const COMMENTS: readonly (readonly [open: string, close: string])[] = [
  ['<!--', '-->'],
  ['/*', '*/'],
  ['//', '\n'],
];

// Strip comments so a MENTION of a constant in prose — which is exactly how the
// two copies justified themselves to each other — never counts either way.
//
// Scanned once, left to right, rather than replaced form by form. A replace pass
// per form has to pick an order, and whichever it picks the other form's opener
// can sit inside it: `// see <!-- x` and `/* // */` strip differently depending
// on who goes first, and a half-stripped comment is the one failure this guard
// cannot afford — a constant merely NAMED in prose would then count as a
// re-declaration, or a real one hide behind a dangling `/*`. Taking whichever
// opener appears FIRST needs no ordering rule and no second pass, so there is
// nothing left for a fixpoint loop to catch (and nothing for CodeQL's
// js/incomplete-multi-character-sanitization to flag).
//
// Quotes are deliberately not tracked: a `//` inside a string is stripped as a
// comment. That over-strips, which can only ever hide drift from a later
// assertion on the same line — never invent one — and tracking quotes would mean
// treating the apostrophe in Svelte prose as a string opener, which swallows
// real comments and fails this suite on wording.
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const found = COMMENTS.find(([open]) => src.startsWith(open, i));
    if (found === undefined) {
      out += src[i];
      i += 1;
      continue;
    }
    const [open, close] = found;
    const end = src.indexOf(close, i + open.length);
    i = end === -1 ? src.length : end + close.length;
    // A space keeps the tokens either side of a block comment apart; a line
    // comment gives its newline back so line-anchored matching still works.
    out += close === '\n' ? '\n' : ' ';
  }
  return out;
}

const defaultsSource = stripComments(readFileSync(defaultsPath, 'utf8'));

/** What `timerDefaults` exports, read from the module rather than restated. */
const GUARDED: readonly string[] = [
  ...defaultsSource.matchAll(/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm),
].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

/** A local binding of that name — the drift this guard exists to catch. */
function redeclares(code: string, name: string): boolean {
  return new RegExp(String.raw`\b(?:const|let|var|function|class|enum)\s+${name}\b`).test(code);
}

const references = (code: string, name: string): boolean =>
  new RegExp(String.raw`\b${name}\b`).test(code);

// ─── The other half of the drift: the VALUE, spelled out ──────────────────────
//
// Everything above catches a file that names a guarded constant. A file that
// inlines the value names nothing — `notify: durationMinutes >= 1.5` declares
// no binding and references no export, so it is invisible to both checks above
// while being precisely what `timerDefaults.ts` says it exists to prevent:
//
//   > A function rather than a bare comparison at each call site so the two
//   > screens cannot end up on opposite sides of the boundary
//
// and precisely what `GuidedCookPage.svelte` carried before #994 deleted it.
// When the floor later moves off its current value — the whole reason it is
// shared — that surface arms no push, silently.

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** The literal each guarded `const` is spelled as, read off the module. */
const VALUES: ReadonlyMap<string, string> = new Map(
  [...defaultsSource.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);/gm)].flatMap(
    (m) => (m[1] === undefined || m[2] === undefined ? [] : [[m[1], m[2].trim()] as const]),
  ),
);

const COMPARISON = String.raw`(?:[<>]=?|[!=]==?)`;

/**
 * A comparison against `literal` — either way round.
 *
 * Only values the module ITSELF compares against are checked this way, which is
 * what keeps the rule from being unusable: `AD_HOC_TIMER_MINUTES = 10` is a
 * starting value, nothing compares to it, and forbidding a bare `> 10` across
 * all of `src` would fire on arithmetic that has nothing to do with timers. Its
 * drift is also the loud kind — a timer that opens at the wrong number is on
 * screen. The floor's is not, which is why it is the one worth this.
 */
function comparesAgainstLiteral(code: string, literal: string): boolean {
  const bounded = String.raw`(?<![\w.])${escapeRegExp(literal)}(?![\w.])`;
  return new RegExp(`${COMPARISON}\\s*${bounded}|${bounded}\\s*${COMPARISON}`).test(code);
}

/** The same string, spelled out in quotes of any kind. */
function spellsOutString(code: string, quotedLiteral: string): boolean {
  const inner = /^(['"`])([\s\S]*)\1$/.exec(quotedLiteral)?.[2];
  return inner === undefined
    ? false
    : new RegExp(String.raw`['"\`]${escapeRegExp(inner)}['"\`]`).test(code);
}

interface Inlineable {
  readonly name: string;
  readonly literal: string;
  /** Which matcher applies, and the words the failure message is written in. */
  readonly how: 'spelled out' | 'compared against';
}

/**
 * Guarded constants whose spelled-out value is itself drift, with why.
 *
 * Derived, never listed: a number earns a check by the module comparing against
 * it (so a second boundary constant is covered the day it is added), a string by
 * being a string (a branded label spelled out anywhere is a second copy of it).
 */
const INLINEABLE: readonly Inlineable[] = [...VALUES].flatMap(([name, literal]): Inlineable[] => {
  if (/^['"`]/.test(literal)) return [{ name, literal, how: 'spelled out' }];
  const comparedByModule = new RegExp(
    String.raw`${COMPARISON}\s*\b${name}\b|\b${name}\b\s*${COMPARISON}`,
  ).test(defaultsSource);
  return comparedByModule ? [{ name, literal, how: 'compared against' }] : [];
});

const inlines = (code: string, { literal, how }: Inlineable): boolean =>
  how === 'spelled out' ? spellsOutString(code, literal) : comparesAgainstLiteral(code, literal);

// Any import of the shared module, however the path is spelled or where from.
const IMPORTS_DEFAULTS = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*timerDefaults(?:\.js)?['"]/;

interface Scanned {
  readonly path: string;
  readonly code: string;
}

const files: Scanned[] = walk(srcDir)
  .filter((path) => path !== defaultsPath)
  .map((path) => ({
    path: relative(srcDir, path).split(sep).join('/'),
    code: stripComments(readFileSync(path, 'utf8')),
  }));

describe('timer defaults are declared once', () => {
  it('exports a non-empty set of names to guard', () => {
    // If this regex ever stops matching, every assertion below passes trivially.
    expect(GUARDED.length).toBeGreaterThan(0);
    expect(GUARDED).toContain('AD_HOC_TIMER_LABEL');
    expect(GUARDED).toContain('AD_HOC_TIMER_MINUTES');
    expect(GUARDED).toContain('NOTIFY_MIN_MINUTES');

    // Same for the value half: if `VALUES` stops parsing, or the module stops
    // comparing against its own floor, the inlining check below has nothing to
    // look for and would pass on any source at all.
    const inlineable = INLINEABLE.map((i) => i.name);
    expect(inlineable).toContain('NOTIFY_MIN_MINUTES'); // compared against
    expect(inlineable).toContain('AD_HOC_TIMER_LABEL'); // a string, spelled out
  });

  it('can still see the source it guards', () => {
    // Not an inventory — an anchor. A walk that narrowed, or a page that moved
    // out from under the guard, fails here instead of going quietly green.
    expect(files.map((f) => f.path.split('/').pop())).toContain('GuidedCookPage.svelte');
    expect(files.length).toBeGreaterThan(1);
  });

  it('recognises a re-declaration when it sees one', () => {
    // The exact shape #994 deleted, as a string — so a regex broken by a future
    // edit fails on this synthetic case rather than on nothing at all.
    expect(redeclares('  const NOTIFY_MIN_MINUTES = 1.5;', 'NOTIFY_MIN_MINUTES')).toBe(true);
    expect(redeclares("  const AD_HOC_TIMER_LABEL = 'Salt Timer';", 'AD_HOC_TIMER_LABEL')).toBe(
      true,
    );
    expect(redeclares('  shouldNotifyFor(entry.durationMinutes)', 'shouldNotifyFor')).toBe(false);
  });

  it('recognises an inlined value when it sees one', () => {
    // The shape `GuidedCookPage.svelte` carried at `main:680` and `:700`, and the
    // one a fourth timer surface would write — neither declares nor references
    // anything, so only this matcher can see it.
    expect(comparesAgainstLiteral('notify: entry.durationMinutes >= 1.5,', '1.5')).toBe(true);
    expect(comparesAgainstLiteral('if (1.5 <= c.atMinutes) arm();', '1.5')).toBe(true);
    expect(spellsOutString("label: label?.trim() || 'Salt Timer',", "'Salt Timer'")).toBe(true);
    expect(spellsOutString('label: "Salt Timer",', "'Salt Timer'")).toBe(true);

    // And what it must NOT see, or the whole-`src` walk turns into noise nobody
    // can act on: the sanctioned call, a neighbouring number, and a longer one
    // the floor is merely a prefix of.
    expect(comparesAgainstLiteral('notify: shouldNotifyFor(entry.durationMinutes),', '1.5')).toBe(
      false,
    );
    expect(comparesAgainstLiteral('if (ratio >= 11.5) grow();', '1.5')).toBe(false);
    expect(comparesAgainstLiteral('if (ratio >= 1.55) grow();', '1.5')).toBe(false);
    expect(spellsOutString("label: 'Salt Timers',", "'Salt Timer'")).toBe(false);
  });

  it('has no file outside lib/timerDefaults.ts declaring one of them', () => {
    const offenders = files.flatMap((file) =>
      GUARDED.filter((name) => redeclares(file.code, name)).map((name) => `${file.path}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no file outside lib/timerDefaults.ts spelling one of their values out', () => {
    // Unconditional — importing the module does not buy a file the right to write
    // the literal beside the import. There is no call site where the number is the
    // clearer of the two, and `shouldNotifyFor` exists so there is never one.
    const offenders = files.flatMap((file) =>
      INLINEABLE.filter((i) => inlines(file.code, i)).map(
        ({ name, literal, how }) => `${file.path}: ${literal} ${how} — import ${name} instead`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('has every file that uses one importing it from the shared module', () => {
    const consumers = files.filter((file) => GUARDED.some((name) => references(file.code, name)));
    // A screen that starts a timer must exist, or the scan is measuring nothing.
    expect(consumers.length).toBeGreaterThan(0);

    const unsourced = consumers.flatMap((file) => {
      const imported = IMPORTS_DEFAULTS.exec(file.code)?.[1] ?? '';
      return GUARDED.filter(
        (name) => references(file.code, name) && !references(imported, name),
      ).map((name) => `${file.path}: ${name}`);
    });
    expect(unsourced).toEqual([]);
  });
});
