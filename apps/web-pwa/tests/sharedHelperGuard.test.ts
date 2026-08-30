/**
 * Source guard: nothing re-declares a display rule (issue #933).
 *
 * Eleven rules that decide what a number, a date, a URL or a viewport READS AS on
 * screen each had between two and eight implementations. Three of them had
 * already drifted into forks a user could see — the same 90-minute bake read
 * `1 h 30 min` on one screen and `1 hr 30 min` on another; a member whose name
 * was typed with a leading space rendered as a blank chef label; a hand-added
 * shopping item showed its provenance in the edit sheet and nothing at all in the
 * row. None of that failed a test, because both spellings are correct-looking and
 * neither throws.
 *
 * The other eight were identical ON THE DAY THEY WERE MEASURED, held that way by
 * prose. That is the state this file replaces: comments asking the next author to
 * keep copies in agreement have now failed twice in this repo — `timerDefaults`
 * (#994, whose guard is this file's template) and `CanonIcon` — and a request is
 * not a mechanism.
 *
 * ── Two halves, because drift has two shapes ─────────────────────────────────
 *
 * A file can copy a rule by NAME (`function formatGrams(g) { … }`) or by VALUE
 * (`new Date().toLocaleDateString('en-CA')` — which declares nothing named and
 * references nothing shared, so a name-only guard cannot see it). Every one of
 * the eleven was found in the second shape at least once, so both are checked.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The guarded NAMES are read out of the owning modules themselves, so renaming
 *    or adding an export moves the guard with it. There is no list of identifiers
 *    to maintain (UT-E1).
 *  - The scan surface is the whole of `src`, walked — not a list of pages. A
 *    twelfth surface that wants one of these rules is covered on the day it is
 *    written (UT-E1).
 *  - Every matcher is exercised against BOTH a synthetic copy it must catch and a
 *    near-miss it must not, so a regex broken by a later edit fails here rather
 *    than passing everything or failing everywhere (UT-E2).
 *  - It asserts on identifiers, imports and value shapes, never on the wording of
 *    the comments beside them and never on a line number (UT-E3) — both are
 *    things this very issue rewrote.
 *
 * ── The honest boundary of the VALUE half ────────────────────────────────────
 *
 * The forbidden shapes below are STATED, not derived, and that is a real
 * limitation rather than an oversight. Three of the rules they cover are owned by
 * `@salt/domain` (`dateInZone`, `recipeHeroUrl`, `memberFirstName`), and UT-E4
 * forbids a `../../../../packages/…` path escape to read their source. So the
 * shapes are written here with the reason attached, and each is pinned by the
 * self-tests below. What that buys is still the thing that matters: the SCAN
 * SURFACE is derived, so nothing can drop out of coverage by moving.
 *
 * It is a genuine source scan — it reads bytes off disk and never imports the
 * modules it checks, so no `vi.mock` can make it agree.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');

/**
 * The modules that OWN a display rule after issue #933, and what each is for.
 *
 * This list is the one thing here that is hand-kept, and it is the right thing to
 * hand-keep: it says which modules are authorities, which is a design decision
 * rather than something readable off the tree. Everything else — which names they
 * export, which files exist — is derived from it.
 */
const OWNERS: readonly { readonly path: string; readonly rule: string }[] = [
  { path: 'lib/durationDisplay.ts', rule: 'how a length of time reads' },
  { path: 'lib/quantityDisplay.ts', rule: 'how a gram figure reads' },
  { path: 'lib/today.ts', rule: 'what day it is here' },
  { path: 'lib/shoppingSource.ts', rule: 'where a shopping item came from' },
  { path: 'lib/mediaQuery.svelte.ts', rule: 'a live media query, read safely' },
  { path: 'lib/reducedMotion.ts', rule: 'the reduced-motion preference' },
  { path: 'lib/swipe.ts', rule: 'the gesture thresholds' },
];

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

/**
 * Strip comments so a MENTION of a rule in prose never counts as a copy of it.
 *
 * This matters more here than almost anywhere: the whole issue consisted of
 * comments describing rules, and several of the modules under `src` now carry
 * sentences like "the hero rule itself is `recipeHeroUrl`". Left in, those would
 * be read as the drift they are documenting.
 *
 * Scanned once, left to right, taking whichever opener appears FIRST — the same
 * approach as `timerDefaultsGuard.test.ts`, and for the same reason: a
 * replace-pass per form has to pick an order, and whichever it picks the other
 * form's opener can sit inside it.
 */
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
    out += close === '\n' ? '\n' : ' ';
  }
  return out;
}

interface Scanned {
  readonly path: string;
  readonly code: string;
}

const ownerPaths = new Set(OWNERS.map((o) => o.path));

const allFiles: Scanned[] = walk(srcDir).map((path) => ({
  path: relative(srcDir, path).split(sep).join('/'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

/** Everything the guard polices — every file except the authorities themselves. */
const files = allFiles.filter((f) => !ownerPaths.has(f.path));

const sourceOf = (path: string): string => {
  const found = allFiles.find((f) => f.path === path);
  if (found === undefined) throw new Error(`guard cannot find its own subject: ${path}`);
  return found.code;
};

// ─── Half one: the rule copied by NAME ────────────────────────────────────────

/** What each owner exports, read from the module rather than restated (UT-E1). */
const GUARDED: readonly {
  readonly name: string;
  readonly owner: string;
  readonly rule: string;
}[] = OWNERS.flatMap(({ path, rule }) =>
  [...sourceOf(path).matchAll(/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].flatMap(
    (m) => (m[1] === undefined ? [] : [{ name: m[1], owner: path, rule }]),
  ),
);

/** A local binding of that name — the drift this guard exists to catch. */
function redeclares(code: string, name: string): boolean {
  return new RegExp(String.raw`\b(?:const|let|var|function|class|enum)\s+${name}\b`).test(code);
}

const references = (code: string, name: string): boolean =>
  new RegExp(String.raw`\b${name}\b`).test(code);

// ─── Half two: the rule copied by VALUE ───────────────────────────────────────

interface Shape {
  /** What a reader should write instead. */
  readonly instead: string;
  /** Why this shape is drift and not merely similar-looking. */
  readonly because: string;
  readonly pattern: RegExp;
  /** Files allowed to carry it, and why. Empty means nowhere in `src`. */
  readonly allowed?: readonly string[];
}

const FORBIDDEN: readonly Shape[] = [
  {
    instead: 'todayIso() from lib/today.js',
    because:
      "five modules each answered 'what day is it here' with this expression; the rule is dateInZone in @salt/domain and the clock belongs to lib/today.ts",
    pattern: /toLocaleDateString\(\s*['"]en-CA['"]/,
  },
  {
    instead: 'recipeHeroUrl(recipe) from @salt/domain',
    because:
      'the hero nonce precedence was written out at eight sites; imageRequestedAt is only ever a cache-buster and only ever falls back to updatedAt',
    pattern: /imageRequestedAt\s*\?\?/,
  },
  {
    instead: 'SPLIT_QUERY from lib/mediaQuery.svelte.js',
    because:
      'three pages carried this literal and the 25-line guarded effect around it; app.css holds the only other legitimate spelling, in the variant form Tailwind needs',
    pattern: /width\s*>=\s*700px/,
  },
  {
    instead: 'prefersReducedMotion() from lib/reducedMotion.js',
    because:
      "svelte/motion's reader is a different API with a different default when matchMedia is missing, which is exactly the case the app's helper exists to get right",
    pattern: /from\s*['"]svelte\/motion['"]/,
  },
  {
    instead: 'memberFirstName from @salt/domain',
    because:
      "split(' ') takes an empty leading field and never sees a tab or a newline as a separator, so a name typed with either rendered wrong",
    pattern: /\.split\(\s*['"] ['"]\s*\)\s*\[\s*0\s*\]/,
  },
];

const carries = (code: string, shape: Shape): boolean => shape.pattern.test(code);

// ─────────────────────────────────────────────────────────────────────────────

describe('display rules are declared once', () => {
  it('can still see the source it guards', () => {
    // Not an inventory — an anchor. A walk that narrowed, or an owner that moved
    // out from under the guard, fails here instead of going quietly green.
    expect(files.length).toBeGreaterThan(100);
    const names = files.map((f) => f.path.split('/').pop());
    expect(names).toContain('RecipeViewPage.svelte');
    expect(names).toContain('ShoppingItemRow.svelte');
    expect(names).toContain('MealPlanWeekPage.svelte');

    // Every owner must actually exist and be excluded from the policed set.
    for (const { path } of OWNERS) {
      expect(allFiles.map((f) => f.path)).toContain(path);
      expect(files.map((f) => f.path)).not.toContain(path);
    }
  });

  it('reads a non-empty set of names out of the owning modules', () => {
    // If the export regex ever stops matching, every name assertion below passes
    // trivially. These four are the rules that had already forked.
    expect(GUARDED.length).toBeGreaterThan(5);
    const names = GUARDED.map((g) => g.name);
    expect(names).toContain('formatMinutes');
    expect(names).toContain('formatGrams');
    expect(names).toContain('todayIso');
    expect(names).toContain('describeSource');
    expect(names).toContain('DRAG_START_PX');
    expect(names).toContain('SPLIT_QUERY');
    expect(names).toContain('prefersReducedMotion');
  });

  it('recognises a re-declaration when it sees one', () => {
    // The exact shapes this issue deleted, as strings — so a regex broken by a
    // future edit fails on these rather than on nothing at all.
    expect(redeclares('  function formatGrams(grams: number): string {', 'formatGrams')).toBe(true);
    expect(redeclares('  const DRAG_START_PX = 6;', 'DRAG_START_PX')).toBe(true);
    expect(redeclares('  const todayIso = () => new Date();', 'todayIso')).toBe(true);
    expect(redeclares("  function describeSource(src) { return ''; }", 'describeSource')).toBe(
      true,
    );

    // And what it must NOT see, or the whole-`src` walk becomes noise: a call,
    // an import, and a longer name this one is merely a prefix of.
    expect(redeclares('  const label = formatGrams(totals.totalGrams);', 'formatGrams')).toBe(
      false,
    );
    expect(redeclares("  import { formatGrams } from '../../lib/quantityDisplay.js';", 'formatGrams')).toBe(false); // prettier-ignore
    expect(redeclares('  const formatGramsRange = (a, b) => a;', 'formatGrams')).toBe(false);
  });

  it('recognises an inlined rule when it sees one', () => {
    const shape = (instead: string): Shape => {
      const found = FORBIDDEN.find((s) => s.instead.startsWith(instead));
      if (found === undefined) throw new Error(`no forbidden shape for ${instead}`);
      return found;
    };

    // Each of these is a real line this issue deleted from `src`.
    expect(carries("  return new Date().toLocaleDateString('en-CA');", shape('todayIso'))).toBe(
      true,
    );
    expect(carries('  appendCacheBuster(r.image.url, r.imageRequestedAt ?? r.updatedAt)', shape('recipeHeroUrl'))).toBe(true); // prettier-ignore
    expect(carries("  const Q = '(width >= 700px) and (height >= 480px)';", shape('SPLIT_QUERY'))).toBe(true); // prettier-ignore
    expect(carries("  import { prefersReducedMotion } from 'svelte/motion';", shape('prefersReducedMotion'))).toBe(true); // prettier-ignore
    expect(carries("  return name.split(' ')[0] ?? name;", shape('memberFirstName'))).toBe(true);

    // And the near-misses each must NOT fire on.
    expect(carries("  formatDayKey(date, { weekday: 'long' });", shape('todayIso'))).toBe(false);
    expect(carries("  new Date().toLocaleDateString('en-GB');", shape('todayIso'))).toBe(false);
    expect(carries('  recipeHeroUrl(recipe)', shape('recipeHeroUrl'))).toBe(false);
    expect(carries('  if (imageRequestedAt !== undefined) refetch();', shape('recipeHeroUrl'))).toBe(false); // prettier-ignore
    expect(carries('  createMediaQuery(SPLIT_QUERY)', shape('SPLIT_QUERY'))).toBe(false);
    expect(carries('  @media (min-width: 700px)', shape('SPLIT_QUERY'))).toBe(false);
    expect(carries("  import { prefersReducedMotion } from './reducedMotion.js';", shape('prefersReducedMotion'))).toBe(false); // prettier-ignore
    expect(carries("  name.trim().split(/\\s+/).filter(Boolean)[0]", shape('memberFirstName'))).toBe(false); // prettier-ignore
    expect(carries("  text.split(', ')[0]", shape('memberFirstName'))).toBe(false);
  });

  it('has no file outside its owning module re-declaring one of them', () => {
    const offenders = files.flatMap((file) =>
      GUARDED.filter(({ name }) => redeclares(file.code, name)).map(
        ({ name, owner, rule }) => `${file.path}: ${name} (${rule}) — import it from ${owner}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('has no file writing one of the rules out by hand', () => {
    const offenders = files.flatMap((file) =>
      FORBIDDEN.filter(
        (shape) => !(shape.allowed ?? []).includes(file.path) && carries(file.code, shape),
      ).map((shape) => `${file.path}: use ${shape.instead} — ${shape.because}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has every file that uses one importing it from the module that owns it', () => {
    const consumers = files.filter((file) =>
      GUARDED.some(({ name }) => references(file.code, name)),
    );
    // A screen that formats a duration or reads the seam must exist, or the scan
    // is measuring nothing.
    expect(consumers.length).toBeGreaterThan(0);

    const unsourced = consumers.flatMap((file) => {
      const imported = [...file.code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g)]
        .map((m) => m[1] ?? '')
        .join(',');
      return GUARDED.filter(
        ({ name }) => references(file.code, name) && !references(imported, name),
      ).map(({ name, owner, rule }) => `${file.path}: ${name} (${rule}) — import it from ${owner}`);
    });
    expect(unsourced).toEqual([]);
  });
});
