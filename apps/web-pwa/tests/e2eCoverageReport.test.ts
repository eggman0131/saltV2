/**
 * The retained opt-in e2e coverage path, made provable (issue #1132).
 *
 * #945 turned V8 collection off by default and KEPT the code, on the promise
 * written at `e2e/fixtures/test.ts` that "nothing is lost locally". Nothing
 * checked that promise. CI never sets `E2E_COVERAGE`, `e2e:coverage` is
 * host-guarded so it cannot be part of any gate, and until this issue
 * `apps/web-pwa/scripts/**` was named by no program in the root `typecheck`
 * script. A `v8-to-istanbul` major or a Playwright coverage-API change would
 * still break it silently, and the discovery moment would have been whenever
 * someone next reached for the report — most likely mid-#913, wanting exactly
 * the `.svelte` measurement this is the only instrument for. The app-origin
 * literal itself is no longer one of these risks (#1142 review, finding 1):
 * `e2e/e2eAppOrigin.ts` is its single source, imported by `globalSetup.ts`
 * (spawns Vite there), `globalTeardown.ts` (kills it there — a fifth copy the
 * review missed, closed in the immediate follow-up, #1132), `playwright.config.ts`
 * (`baseURL`), `e2eServerRegistry.ts` (the sentinel filename, a sixth copy
 * closed by #1162) and the script under test — so a port move is one edit, not
 * six independently-drifting copies. The consumer set is WALKED rather than
 * listed (#1168), so this sentence is a summary of what the guard finds, not
 * the thing the guard reads.
 *
 * So this test runs the real converter, end to end, over a raw V8 dump shaped
 * like the one the fixture writes: a real `node --experimental-strip-types`
 * child process, the real `v8-to-istanbul` → `istanbul-lib-coverage` →
 * `istanbul-reports` chain, real files on disk. No Playwright, no browser, no
 * emulator, no host singleton — so it runs from `pnpm test` in any worktree,
 * which is the constraint that ruled out a collect-and-report run.
 *
 * ── Why the assertions are about CONTENT ────────────────────────────────────
 *
 * The script filters entries to `APP_ORIGIN` and swallows conversion failures
 * in a bare `catch`. Both are right for a tool run over whatever Vite happened
 * to serve, and both mean a broken pipeline still exits 0 and still writes an
 * `lcov.info` — an empty one. Asserting "the file exists" would therefore be
 * vacuous by construction. The assertions below are per-function hit counts
 * that can only appear if the dump was read, origin-filtered, converted and
 * merged, plus a negative case proving the origin filter still excludes.
 *
 * ── Limits ──────────────────────────────────────────────────────────────────
 *
 * This proves the PROCESSING half. It does not exercise the Playwright fixture
 * at `e2e/fixtures/test.ts:63-83` — `page.coverage.startJSCoverage()` needs a
 * browser, and that is the host-guarded run this test exists to avoid. What
 * couples the two is the dump SHAPE, so the fixture below is the shape
 * `stopJSCoverage()` returns; if Playwright ever changes it, this test keeps
 * passing on the old shape. That gap is the price of being runnable anywhere.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E_APP_ORIGIN, E2E_APP_PORT } from '../e2e/e2eAppOrigin';

// `fileURLToPath(import.meta.url)` on the STRING, not `new URL('..', …)`: this
// suite runs under jsdom, whose global `URL` is whatwg-url rather than Node's,
// and Node rejects that object with "The URL must be of scheme file". Same
// shape as `tests/sharedHelperGuard.test.ts:67`.
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(APP_DIR, 'scripts', 'process-e2e-coverage.ts');
const REPO_ROOT = join(APP_DIR, '..', '..');

/**
 * The origin `process-e2e-coverage.ts` filters on — the e2e Vite server.
 * Imported from `../e2e/e2eAppOrigin.ts`, the single source of truth every
 * consumer shares (#1142 review, finding 1), not repeated as a literal here.
 */
const APP_ORIGIN = E2E_APP_ORIGIN;

/**
 * One `used` function called three times and one `unused` never called, so the
 * report has a non-trivial number to get wrong in both directions.
 *
 * The `functions`/`ranges` below are not invented — they are the actual
 * `Profiler.takePreciseCoverage()` output (the same V8 Profiler domain
 * `page.coverage.startJSCoverage()` wraps) for exactly this source string,
 * captured via `node:inspector` with `used` called 3 times and `unused` never
 * called, then confirmed to convert to the `FNDA`/`FNF`/`FNH` lines asserted
 * below. Offsets are byte ranges into `source`: the whole-script range spans
 * `[0, source.length)`; each function range starts at its own `function`
 * keyword (not the `export` before it) and ends one past its closing `}`
 * (#1142 review, finding 5 — the previous ranges ran 5-19 bytes past EOF and
 * one started mid-identifier, so `v8-to-istanbul`'s clamping — not the offset
 * mapping — was what made the old assertions pass).
 */
const MEASURED_SOURCE =
  'export function used(a) {\n  return a + 1;\n}\n\nexport function unused(b) {\n  return b - 1;\n}\n';

const rawDump = [
  {
    url: `${APP_ORIGIN}/src/lib/sampleModule.js`,
    source: MEASURED_SOURCE,
    functions: [
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: [{ startOffset: 0, endOffset: 91, count: 1 }],
      },
      {
        functionName: 'used',
        isBlockCoverage: true,
        ranges: [{ startOffset: 7, endOffset: 43, count: 3 }],
      },
      {
        // Real V8 output marks a never-invoked function's range as NOT
        // block coverage — block-level instrumentation never ran for it.
        functionName: 'unused',
        isBlockCoverage: false,
        ranges: [{ startOffset: 52, endOffset: 90, count: 0 }],
      },
    ],
  },
  // A third-party script the page also loaded. Given real source and a real
  // function on purpose: it is convertible, so it lands in the report the
  // moment the origin filter stops filtering.
  {
    url: 'https://cdn.example.invalid/foreignOrigin.js',
    source: 'export function foreign() {\n  return 0;\n}\n',
    functions: [
      {
        functionName: 'foreign',
        isBlockCoverage: true,
        ranges: [{ startOffset: 0, endOffset: 42, count: 1 }],
      },
    ],
  },
];

function runScript(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT], {
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('process-e2e-coverage.ts', () => {
  describe('over a raw V8 dump', () => {
    let workDir: string;
    let run: ReturnType<typeof runScript>;
    let lcov: string;

    beforeAll(() => {
      workDir = mkdtempSync(join(tmpdir(), 'salt-e2e-cov-'));
      const rawDir = join(workDir, 'coverage', 'e2e-raw');
      mkdirSync(rawDir, { recursive: true });
      writeFileSync(join(rawDir, 'some-test-abc123.json'), JSON.stringify(rawDump));
      run = runScript(workDir);
      // Assert the exit status BEFORE reading lcov.info: reading first meant a
      // broken script surfaced as an opaque ENOENT from the read below, with
      // the child's actual stderr — the real cause — never printed (#1142
      // review, finding 3).
      expect(run.status, `process-e2e-coverage.ts failed:\nstderr: ${run.stderr}`).toBe(0);
      lcov = readFileSync(join(workDir, 'coverage', 'e2e', 'lcov.info'), 'utf8');
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it('writes both reporters into coverage/e2e/', () => {
      expect(run.stdout).toContain('Processing 1 raw coverage file(s)');
      // The lcov read in beforeAll would have thrown had that reporter not run;
      // html is the other one the script creates, and nothing else asserts it.
      expect(readFileSync(join(workDir, 'coverage', 'e2e', 'index.html'), 'utf8')).toContain(
        'html',
      );
    });

    it('carries per-function hit counts through the V8 → istanbul conversion', () => {
      expect(lcov).toContain('sampleModule.js');
      // 3 calls and 0 calls, not merely "a record exists". These are the
      // numbers the whole chain exists to produce.
      expect(lcov).toContain('FNDA:3,used');
      expect(lcov).toContain('FNDA:0,unused');
      expect(lcov).toContain('FNF:2');
      expect(lcov).toContain('FNH:1');
    });

    it('excludes entries served from another origin', () => {
      expect(lcov).not.toContain('foreignOrigin.js');
      expect(lcov).not.toContain('FNDA:1,foreign');
    });
  });

  it('exits non-zero when there is nothing to process', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'salt-e2e-cov-empty-'));
    try {
      // The expected state for anyone who ran a plain `e2e`: collection is
      // opt-in, so no raw directory exists. It must fail loudly rather than
      // write an empty report that reads as "nothing is covered".
      expect(runScript(emptyDir).status).not.toBe(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('is the same invocation `pnpm e2e:coverage:report` runs', () => {
    // Without this the test could keep passing while the command a developer
    // actually types had moved on — a different runner, a renamed script, a
    // flag the file no longer survives. Whether the runner still ACCEPTS the
    // file is proven by the real spawn in `runScript` above, not here: `node
    // --experimental-strip-types --check` is not a stricter grammar check —
    // measured on node v22.22.3, it exits 0 for a `.ts` file containing an
    // `enum`, a parameter property, or outright unparseable syntax, because
    // `--check` never strips types and a `.ts` file detected as ESM does
    // nothing under it (#1142 review, finding 2).
    const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['e2e:coverage:report']).toBe(
      'node --experimental-strip-types scripts/process-e2e-coverage.ts',
    );
  });

  describe('single source of truth for the app origin (#1142 review, finding 1)', () => {
    // Before `e2eAppOrigin.ts`, `http://127.0.0.1:5174` lived as independent
    // literal copies — this script, this test, `globalSetup.ts` and
    // `playwright.config.ts` (the four the #1142 review named), plus
    // `globalTeardown.ts`'s own `E2E_APP_PORT`, a fifth the review missed and
    // the immediate follow-up (#1132) closed — that could disagree silently:
    // change the port in some but not all and `pnpm test` / `pnpm typecheck`
    // stayed green while `e2e:coverage` quietly filtered out every real entry.
    // A wiring guard is the only way to make that regression go red WITHOUT a
    // browser: it can't run the actual Playwright/Vite pairing (host-guarded),
    // so instead it asserts, from source text, that every consumer still
    // imports the shared constant rather than a reintroduced literal.
    //
    // ── The net, stated as what it does and does not catch (#1162 §4) ────────
    //
    // Until #1162 the import half was `expect(src).toContain(importSpecifier)`,
    // a substring test over the whole file — and three of the four consumers
    // carry the specifier in a HEADER COMMENT as well as in the import
    // (playwright.config.ts:29, globalSetup.ts:43, globalTeardown.ts:22). So
    // deleting globalTeardown.ts's real import and re-declaring
    // `const E2E_APP_PORT = 5174` locally left all 9 tests green: only
    // process-e2e-coverage.ts was genuinely pinned, and only by the accident
    // that its comment says `e2eAppOrigin.ts` rather than `../e2e/…`.
    //
    // Two assertions replace it, and between them they cover both shapes of the
    // fifth copy:
    //   IMPORT_OF     — an actual `import … from '<specifier>'` STATEMENT, which
    //                   a `//` comment cannot satisfy (its line begins `//`,
    //                   never `import`) and a `/* … */` block comment is
    //                   stripped before matching, so an archaeological block
    //                   quoting a removed import line can't satisfy it either.
    //   SHADOW_DECL   — a local `const`/`let`/`var`/`function`/`class` binding
    //                   one of the three exported names, AT ANY VALUE. Value-
    //                   agnostic on purpose: it reds both on a shadow copy that
    //                   agrees with the shared constant today (the mutation
    //                   above) and on one that has already drifted, where a
    //                   number-based rule would only ever catch the second.
    //
    // Rejected: banning a bare `5174` literal. Measured — globalSetup.ts:344,352
    // print `:5174` inside real template-literal log strings, and seven more
    // comment lines mention it — so that rule needs comment-stripping AND two
    // log strings rewritten, and is still blind to a copy holding a different
    // number. More work for a weaker net.
    //
    // What neither catches, stated honestly — the earlier version of this
    // paragraph listed the two review-visible shapes and omitted the one that
    // has ACTUALLY recurred (#1168):
    //   - THE LIST WAS SHORT. Twice. `CONSUMERS` used to be five hand-written
    //     entries, and a copy in a file nobody had added to it was invisible:
    //     #1132 found the fifth (`globalTeardown.ts`), #1162 the sixth
    //     (`SENTINEL_PATH`). That is UT-E1's exact failure — "a hard-coded list
    //     of files silently stops covering whatever is added next" — and it is
    //     why the surface below is now WALKED, not typed.
    //   - a consumer that imports the constant and then ignores it, and a
    //     shadow copy under a DIFFERENT name (`const PORT = 5174`). Both are
    //     visible in review, and neither has occurred.
    //
    // ── The surface, derived (UT-E1) ────────────────────────────────────────
    //
    // Every `.ts` in the e2e wiring: the `e2e/` tree walked in full, plus the
    // two files outside it that Playwright and the coverage script own. A file
    // in that scope is a CONSUMER if it imports `e2eAppOrigin`, and consumers
    // are checked for the two copy shapes. A file in that scope that mentions
    // the port WITHOUT importing is a failure by construction — that is the
    // "stopped importing and hard-coded it" regression, which an inclusion list
    // could never see because such a file simply drops out of it.
    //
    // `e2eAppOrigin.ts` is excluded: it IS the declaration.
    const WIRING_ROOTS = [
      join(APP_DIR, 'e2e'),
      join(APP_DIR, 'playwright.config.ts'),
      join(APP_DIR, 'scripts', 'process-e2e-coverage.ts'),
    ];
    const DECLARATION = join(APP_DIR, 'e2e', 'e2eAppOrigin.ts');

    const walk = (entry: string): string[] => {
      if (!statSync(entry).isDirectory()) return entry.endsWith('.ts') ? [entry] : [];
      return readdirSync(entry).flatMap((name) => walk(join(entry, name)));
    };
    const WIRING_FILES = WIRING_ROOTS.flatMap(walk).filter((file) => file !== DECLARATION);

    // Built from the imported constant, not a hard-coded `5174`, so a genuine
    // future port change doesn't need this guard edited too — only a literal
    // reintroduced *alongside* the import would ever trip it. These files also
    // legitimately mention OTHER 127.0.0.1 ports (globalSetup.ts's emulator
    // clear URLs), so the pattern targets this app's origin specifically.
    // Escapes every regex metacharacter, not just `.` — a dot-only escape
    // (flagged by CodeQL js/incomplete-sanitization) would silently under-match
    // if `E2E_APP_HOST`/`E2E_APP_ORIGIN` ever gained another metacharacter (e.g.
    // an IPv6 loopback's brackets), defeating the guard this test exists to be.
    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // No leading-quote anchor. It used to require one, which is how
    // `docker/test-emulators/healthcheck.sh:31` — `-H 'Origin: http://…:5174'`,
    // a real copy with the quote one field earlier — read as clean (#1168).
    const STRAY_LITERAL_ORIGIN = new RegExp(escapeRegExp(E2E_APP_ORIGIN));

    /** A real `import … from '…e2eAppOrigin'`, single- or multi-line, at
     *  whatever relative depth the importer spells it — the per-file specifier
     *  the hand-kept list used to carry was pure bookkeeping. Anchored to a
     *  line that STARTS with `import` (`m` flag), which is what a `//` comment
     *  mentioning the module cannot do: its line starts `//`. A `/* … *\/`
     *  block comment CAN open a line with `import` (its body lines carry no
     *  required prefix), so this matches against `stripBlockComments(src)`, not
     *  raw `src`. The clause body is `[^;]*?` so a braced multi-line import
     *  still matches, and stops at the statement's own semicolon so it cannot
     *  reach across one import into the next. */
    const IMPORTS_DECLARATION = /^\s*import\s[^;]*?from\s*['"`][^'"`]*e2eAppOrigin(?:\.ts)?['"`]/m;

    /** Strips `/* … *\/` block comments only — `//` line comments are already
     *  excluded by `IMPORTS_DECLARATION`'s line anchor, and stripping them too
     *  would just as happily hide a real import that follows one on the same
     *  line. */
    const stripBlockComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

    /** A local binding of one of the three exported names, at any value — the
     *  shape #1132 removed from globalTeardown.ts and the one #1162 reproduced.
     *  Not comment-stripped: a comment containing the literal text
     *  `const E2E_APP_PORT` would be a FALSE POSITIVE, which is the harmless
     *  direction — and is not the case in any file the walk reaches. This test
     *  file carries that exact text, here and in the prose above, and is safe
     *  only because it sits in `tests/` rather than inside `WIRING_ROOTS`; move
     *  it under one and it reds itself. `e2eAppOrigin.ts` is filtered out of
     *  the walk, so its own declarations are never scanned. */
    const SHADOW_DECLARATION =
      /\b(?:const|let|var|function|class)\s+(?:E2E_APP_HOST|E2E_APP_PORT|E2E_APP_ORIGIN)\b/;

    const MENTIONS_PORT = new RegExp(`\\b${E2E_APP_PORT}\\b`);

    const rel = (file: string): string => relative(APP_DIR, file);
    const wiring = WIRING_FILES.map((file) => {
      const src = readFileSync(file, 'utf8');
      return { file, src, imports: IMPORTS_DECLARATION.test(stripBlockComments(src)) };
    });
    const consumers = wiring.filter(({ imports }) => imports);

    // UT-E2: the walk must still FIND something, and specifically the entry
    // points that cannot stop being consumers without the e2e run breaking.
    // A re-narrowing of `WIRING_ROOTS` — the way `aiTimeoutGuard` was once
    // narrowed to `src/flows` — reds here rather than passing on an empty set.
    it('walks a surface that still contains the wiring entry points', () => {
      expect(consumers.map(({ file }) => rel(file)).sort()).toEqual(
        expect.arrayContaining([
          'e2e/globalSetup.ts',
          'e2e/globalTeardown.ts',
          'playwright.config.ts',
          'scripts/process-e2e-coverage.ts',
        ]),
      );
    });

    it.each(consumers.map(({ file, src }) => ({ label: rel(file), src })))(
      '$label derives the origin from e2eAppOrigin.ts',
      ({ src }) => {
        // A stray literal origin here — even alongside the import — is the
        // drift finding 1 flagged: a second, independently-editable copy of the
        // port that the import no longer prevents. `e2eAppOrigin.ts` itself is
        // exempt (it IS the literal) and is filtered out of the walk.
        expect(src).not.toMatch(STRAY_LITERAL_ORIGIN);
        // And the other shape of the same copy: a local re-declaration. It reds
        // whatever value it holds, so a shadow that agrees with the shared
        // constant today is caught as well as one that has already drifted.
        expect(src, 'a local re-declaration shadows the shared constant').not.toMatch(
          SHADOW_DECLARATION,
        );
      },
    );

    it('leaves no file in the wiring holding the port without importing it', () => {
      const holdouts = wiring
        .filter(({ imports, src }) => !imports && MENTIONS_PORT.test(src))
        .map(({ file }) => rel(file));
      expect(
        holdouts,
        'these spell the e2e port themselves — import E2E_APP_PORT from e2e/e2eAppOrigin instead',
      ).toEqual([]);
    });
  });

  describe('copies of the origin outside the import graph (#1168)', () => {
    // The wiring guard above only reaches files that CAN import the constant.
    // Two real copies live where an import is not available, and both were
    // invisible to every assertion in this file until #1168 — which is the
    // limit worth writing down rather than the guard worth extending: a shell
    // script and a `.mjs` cannot import a `.ts`, so no amount of scanning turns
    // them into consumers. What this does instead is make the SET of them
    // closed, so a third one has to be added here deliberately.
    const ACKNOWLEDGED: ReadonlyArray<{ file: string; why: string }> = [
      {
        file: 'docker/test-emulators/healthcheck.sh',
        why: 'shell — sends the origin as a CORS preflight header; cannot import a .ts constant',
      },
      {
        file: 'apps/web-pwa/tests/flakeReporter.test.ts',
        why: 'a fixture string reproducing a reporter error message, not a live URL',
      },
      { file: 'docs/e2e.md', why: 'prose describing the e2e topology' },
      { file: 'apps/web-pwa/tests/e2eCoverageReport.test.ts', why: 'this file — the guard itself' },
    ];

    it('has no unacknowledged copy of the app origin anywhere in the tree', () => {
      const tracked = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
        .filter((file) => !/\.(png|webp|jpg|jpeg|ico|woff2?|pdf|lock)$/.test(file));

      const holders = tracked.filter((file) => {
        const full = join(REPO_ROOT, file);
        return (
          existsSync(full) &&
          statSync(full).isFile() &&
          readFileSync(full, 'utf8').includes(E2E_APP_ORIGIN)
        );
      });

      expect(
        holders.filter((file) => !ACKNOWLEDGED.some((entry) => entry.file === file)),
        'a new copy of the app origin — import it, or acknowledge it above with a reason',
      ).toEqual([]);
    });

    it('acknowledges nothing that has stopped holding a copy', () => {
      // The other direction, so the list cannot rot into a set of stale
      // exemptions that quietly re-open the hole they document.
      const stale = ACKNOWLEDGED.filter(
        ({ file }) => !readFileSync(join(REPO_ROOT, file), 'utf8').includes(E2E_APP_ORIGIN),
      ).map(({ file }) => file);
      expect(stale, 'no longer holds the origin — drop the acknowledgement').toEqual([]);
    });
  });
});
