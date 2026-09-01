/**
 * Source guard: no subscription swallows its stream errors (issue #1053).
 *
 * Salt's error-reporting policy decides what reaches PostHog from the error's
 * CATEGORY — `docs/salt-architecture.md` §7.6, *Coverage*: "Do not report at
 * only the subset of sites that happen to expose an `onError` callback." For a
 * long time that was false. Reporting was per-call-site opt-in, and twelve of
 * the thirty subscription call sites in this app had not opted in: appSettings,
 * devSettings, equipment and its icons, every meal-plan document, the roster,
 * the shop-day markers and the weather cache had no failure telemetry at all.
 * Three of them said in a comment that the adapter was reporting instead, which
 * Rule 4 makes impossible — `firebase-sync` may not import `observability`.
 *
 * The failure it prevents is SILENT. A subscription that reports nothing does
 * not throw, does not log, and does not fail a page test. The user sees stale
 * or empty; nobody else sees anything. Nothing else in CI would ever say so —
 * §7.6's *Enforcement* paragraph rules out `eslint-plugin-boundaries` for this
 * by name, and it is right to: "this callback must call that function" is a
 * call-graph fact, not an import-graph one.
 *
 * ── What it accepts ──────────────────────────────────────────────────────────
 *
 * The LOOSE form, as settled on the issue. A call site's error argument passes
 * if it is the shared `subscriptionErrorHandler(...)` — the shape #1053 Phase 1
 * introduced, and the one that makes reporting free — or if it lexically
 * reaches `reportSubscriptionError`, which is how the eighteen sites that were
 * already correct spell it. Both are real paths to the category gate; requiring
 * only the first would have put those eighteen out of compliance on the day
 * this landed, for no gain in coverage.
 *
 * What it rejects is the shape the twelve had: an error argument that does
 * neither, and therefore reaches no gate at all.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The subscription names come from the `@salt/firebase-sync` BARREL, not a
 *    list kept here. A 29th `subscribe*` export is covered the day it is
 *    written (UT-E1). `docs/unit-test-spec.md:165` uses this very surface as its
 *    worked example.
 *  - The file set is the whole of `src`, walked — `.ts` AND `.svelte`. A call
 *    site in a new component is covered the day it is written (UT-E1). The
 *    `.svelte` half is not incidental: `routes/admin/WeatherForecastField.svelte`
 *    is the twelfth site, and it went unlisted in #928 precisely because
 *    TypeScript symbol tools cannot see `.svelte` files (CLAUDE.md, *Code search*).
 *    A walk that regressed to TS-only would rebuild that blind spot, so the
 *    suite asserts both extensions are present among the call sites.
 *  - It asserts on STRUCTURE — the call, its argument list, the identifier in
 *    it — and never on the wording of a comment (UT-E3). Phase 1 rewrote three
 *    comments at these very sites; prose is the last thing a guard may depend on.
 *  - It proves it can still see (UT-E2): the barrel set must be non-empty and
 *    still contain the names the defect was found on, the walk must find both
 *    file kinds and at least the thirty call sites that existed at the time,
 *    and the matcher is exercised against synthetic fixtures — the violating
 *    handler it must catch AND the near-misses it must not fire on.
 *
 * It is a genuine source scan — it reads bytes off disk and never imports the
 * modules it checks, so no `vi.mock` can make it agree.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(testDir, '../src');
// Resolved through the package specifier rather than a `../../../packages/…`
// climb out of this app — `docs/unit-test-spec.md` UT-E4. `@salt/firebase-sync`
// declares `"exports": { ".": "./src/index.ts" }`, so this lands on the barrel
// wherever the package sits, and the assertions at the bottom of this file are
// what say it landed on the right one. `createRequire` and not
// `import.meta.resolve`, which is not proven to work under Vite's transform.
const barrelPath = createRequire(import.meta.url).resolve('@salt/firebase-sync');

/** Every source file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!entry.isFile()) return [];
    return entry.name.endsWith('.ts') || entry.name.endsWith('.svelte') ? [full] : [];
  });
}

// The three comment forms a `.ts` or `.svelte` file can carry, each as its
// opener and what closes it. A line comment closes at the newline, kept.
const COMMENTS: readonly (readonly [open: string, close: string])[] = [
  ['<!--', '-->'],
  ['/*', '*/'],
  ['//', '\n'],
];

// Strip comments before anything else looks at the source. A comment MENTIONING
// `reportSubscriptionError` must not buy a call site compliance — and three of
// the twelve carried exactly that kind of prose, claiming a reporting path that
// Rule 4 forbids ever existing. Comments are also the one thing Phase 1 rewrote
// at these sites, so depending on them would fail on wording (UT-E3).
//
// Scanned once, left to right, taking whichever opener appears FIRST, so there
// is no ordering rule to get wrong: `// see <!-- x` and `/* // */` strip
// differently depending on who goes first, and a half-stripped comment is the
// failure this guard cannot afford. Modelled on timerDefaultsGuard.test.ts.
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

/** Names the barrel exports that open a realtime subscription. */
const SUBSCRIPTIONS: readonly string[] = [
  ...new Set(
    [...stripComments(readFileSync(barrelPath, 'utf8')).matchAll(/\bsubscribe[A-Z][A-Za-z]*\b/g)]
      .map((m) => m[0])
      .filter((n): n is string => n !== undefined),
  ),
].sort();

// ─── Reading a call's arguments ───────────────────────────────────────────────
//
// The error handler is the LAST argument at every one of these signatures —
// `subscribeMembers(onSnapshot, onError)`, `subscribeMealPlanWeek(start, …, …)`,
// `subscribeShoppingDaysInRange(from, to, …, …)` — which is what lets one rule
// cover an `onError` sitting at index 1, 2 or 3 without restating any signature
// here. Restating them would be the hand-kept list UT-E1 forbids.
//
// Quotes are tracked (unlike in the comment strip, where over-stripping is
// safe): a comma inside a string would otherwise split one argument into two
// and hand the check the wrong tail.

/** The text between the parens of the call starting at `open`, or null if unbalanced. */
function readCallArgs(code: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return null;
}

/** `args` split on top-level commas only. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((a) => a.trim()).filter((a) => a.length > 0);
}

interface CallSite {
  readonly path: string;
  readonly fn: string;
  /** The last argument — the error handler at every signature in play. */
  readonly errorArg: string;
}

/** Every barrel-subscription call in `code`, with the argument that handles its errors. */
function callSitesIn(path: string, code: string): CallSite[] {
  return SUBSCRIPTIONS.flatMap((fn) => {
    const calls: CallSite[] = [];
    // `\s*\(` is what separates a CALL from the import that names it — and it
    // keeps `subscribeBatch` from matching inside `subscribeBatches(`.
    const at = new RegExp(String.raw`\b${fn}\s*\(`, 'g');
    for (const m of code.matchAll(at)) {
      const open = m.index + m[0].length - 1;
      const args = readCallArgs(code, open);
      if (args === null) continue;
      const parts = splitArgs(args);
      const errorArg = parts[parts.length - 1];
      if (errorArg === undefined) continue;
      calls.push({ path, fn, errorArg });
    }
    return calls;
  });
}

/**
 * Does this error argument reach the category gate?
 *
 * The LOOSE form, per the settled open question on #1053: the shared handler,
 * or any argument that lexically reaches `reportSubscriptionError`. Both are
 * real paths to `ErrorReportingPort.report`; nothing else is.
 */
function reportsErrors(errorArg: string): boolean {
  return (
    /\bsubscriptionErrorHandler\s*\(/.test(errorArg) || /\breportSubscriptionError\b/.test(errorArg)
  );
}

const files = walk(srcDir).map((path) => ({
  path: relative(srcDir, path).split(sep).join('/'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

const callSites = files.flatMap((f) => callSitesIn(f.path, f.code));

describe('every subscription reports its stream errors', () => {
  it('derives a non-empty subscription set from the firebase-sync barrel', () => {
    // If this stops matching, every assertion below passes on an empty set.
    expect(SUBSCRIPTIONS.length).toBeGreaterThan(0);
    // Anchored on NAMES rather than a count, so adding a 29th export is not a
    // failure — but losing the ones the defect was found on is.
    expect(SUBSCRIPTIONS).toContain('subscribeAppSettings');
    expect(SUBSCRIPTIONS).toContain('subscribeMealPlanWeek');
    expect(SUBSCRIPTIONS).toContain('subscribeShoppingDaysInRange');
    expect(SUBSCRIPTIONS).toContain('subscribeWeatherForecast');
    // 28 at time of writing. A floor, not the number.
    expect(SUBSCRIPTIONS.length).toBeGreaterThanOrEqual(28);
  });

  it('can still see the call sites it guards, in BOTH file kinds', () => {
    // 30 at time of writing. A walk that narrowed fails here rather than going
    // quietly green on the handful it can still reach.
    expect(callSites.length).toBeGreaterThanOrEqual(30);

    // The `.svelte` half is the whole reason this is a byte scan. Serena and
    // every TS-symbol tool return zero for `.svelte` consumers, which is how
    // WeatherForecastField's silent listener went unlisted in #928.
    const extensions = new Set(callSites.map((c) => c.path.split('.').pop()));
    expect(extensions).toContain('svelte');
    expect(extensions).toContain('ts');
  });

  it('reads the arguments of a call rather than its text', () => {
    // Nesting, and a comma inside a string, both of which appear at real sites.
    expect(splitArgs('start, addCalendarDays(start, 6), (d) => f(d), h()')).toEqual([
      'start',
      'addCalendarDays(start, 6)',
      '(d) => f(d)',
      'h()',
    ]);
    expect(splitArgs(`'a, b', second`)).toEqual([`'a, b'`, 'second']);

    // A call whose parens never close must not silently yield a wrong tail.
    expect(readCallArgs('subscribeX(a, b', 'subscribeX'.length)).toBeNull();

    // The import that NAMES a subscription is not a call site.
    expect(callSitesIn('x.ts', "import { subscribeMembers } from '@salt/firebase-sync';")).toEqual(
      [],
    );
    // Nor is a longer name the short one is a prefix of.
    expect(callSitesIn('x.ts', 'subscribeBatches(on, h);').map((c) => c.fn)).toEqual([
      'subscribeBatches',
    ]);
  });

  it('recognises a reporting handler, and a silent one', () => {
    // The two shapes that pass — the shared handler Phase 1 introduced, with and
    // without store work, and the hand-written form the eighteen already used.
    expect(reportsErrors('subscriptionErrorHandler()')).toBe(true);
    expect(reportsErrors('subscriptionErrorHandler(() => _isLoading.set(false))')).toBe(true);
    expect(
      reportsErrors('(err, rawError) => { reportSubscriptionError(errors, err, rawError); }'),
    ).toBe(true);

    // And the shapes the twelve had — every one of which must fail, or Phase 1
    // could be reverted without this suite noticing.
    expect(reportsErrors('() => _isLoading.set(false)')).toBe(false);
    expect(reportsErrors('(_err) => {}')).toBe(false);
    expect(reportsErrors('(err) => { corrupt = err.kind === "StorageError"; }')).toBe(false);
    // Near-miss: a differently-named local helper is not the reporting path.
    expect(reportsErrors('(err) => handleSubscriptionError(err)')).toBe(false);
  });

  it('has no subscription call site whose error handler reports nothing', () => {
    const silent = callSites
      .filter((c) => !reportsErrors(c.errorArg))
      .map(({ path, fn }) => `${path}: ${fn}`);
    expect(silent).toEqual([]);
  });
});
