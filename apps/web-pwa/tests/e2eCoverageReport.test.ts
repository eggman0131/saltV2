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
 * (`baseURL`), the script under test, and this test's fixture below — so a port
 * move is one edit, not five independently-drifting copies.
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
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E_APP_ORIGIN } from '../e2e/e2eAppOrigin';

// `fileURLToPath(import.meta.url)` on the STRING, not `new URL('..', …)`: this
// suite runs under jsdom, whose global `URL` is whatwg-url rather than Node's,
// and Node rejects that object with "The URL must be of scheme file". Same
// shape as `tests/sharedHelperGuard.test.ts:67`.
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(APP_DIR, 'scripts', 'process-e2e-coverage.ts');

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
    // What neither catches: a consumer that imports the constant and then
    // ignores it, and a shadow copy under a DIFFERENT name (`const PORT = 5174`).
    // Both are visible in review; neither is the shape that has actually
    // occurred twice.
    const CONSUMERS: ReadonlyArray<{ label: string; file: string; importSpecifier: string }> = [
      {
        label: 'playwright.config.ts',
        file: join(APP_DIR, 'playwright.config.ts'),
        importSpecifier: './e2e/e2eAppOrigin',
      },
      {
        label: 'e2e/globalSetup.ts',
        file: join(APP_DIR, 'e2e', 'globalSetup.ts'),
        importSpecifier: './e2eAppOrigin',
      },
      {
        label: 'e2e/globalTeardown.ts',
        file: join(APP_DIR, 'e2e', 'globalTeardown.ts'),
        importSpecifier: './e2eAppOrigin',
      },
      {
        label: 'scripts/process-e2e-coverage.ts',
        file: SCRIPT,
        importSpecifier: '../e2e/e2eAppOrigin.ts',
      },
      // Added by #1162. `SENTINEL_PATH` was a sixth copy of the port, written
      // out as `salt-e2e-5174.json`; both globalSetup and globalTeardown import
      // that one constant, so a port move misnamed the file CONSISTENTLY rather
      // than causing a disagreement — a documentation defect, not a correctness
      // one, which is why it survived #1132. It now derives from `E2E_APP_PORT`,
      // and the import is clean: `e2eAppOrigin.ts` imports nothing and has no
      // side effects, so there is no load-order reason to keep it out.
      {
        label: 'e2e/e2eServerRegistry.ts',
        file: join(APP_DIR, 'e2e', 'e2eServerRegistry.ts'),
        importSpecifier: './e2eAppOrigin',
      },
    ];

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
    const STRAY_LITERAL_ORIGIN = new RegExp(`['"\`]${escapeRegExp(E2E_APP_ORIGIN)}`);

    /** A real `import … from '<specifier>'`, single- or multi-line. Anchored to
     *  a line that STARTS with `import` (`m` flag), which is what a `//`
     *  comment mentioning the specifier cannot do: its line starts `//`. A
     *  `/* … *\/` block comment CAN open a line with `import` (its body lines
     *  carry no required prefix), so callers must match against
     *  `stripBlockComments(src)`, not raw `src` — see the call site below. The
     *  clause body is `[^;]*?` so a braced multi-line import still matches,
     *  and stops at the statement's own semicolon so it cannot reach across
     *  one import into the next. */
    const importOf = (specifier: string): RegExp =>
      new RegExp(`^\\s*import\\s[^;]*?from\\s*['"\`]${escapeRegExp(specifier)}['"\`]`, 'm');

    /** Strips `/* … *\/` block comments only — `//` line comments are already
     *  excluded by `importOf`'s line anchor, and stripping them too would just
     *  as happily hide a real import that follows one on the same line. */
    const stripBlockComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

    /** A local binding of one of the three exported names, at any value — the
     *  shape #1132 removed from globalTeardown.ts and the one #1162 reproduced.
     *  Not comment-stripped: a comment containing the literal text
     *  `const E2E_APP_PORT` would be a FALSE POSITIVE, which is the harmless
     *  direction — and is not the case in the five files CONSUMERS scans today
     *  (this test file itself carries that exact text, in this comment and in
     *  the review-history prose above, which is exactly why this file can
     *  never join CONSUMERS without being reworded). `e2eAppOrigin.ts` is not
     *  a consumer either, so its own declarations are never scanned. */
    const SHADOW_DECLARATION =
      /\b(?:const|let|var|function|class)\s+(?:E2E_APP_HOST|E2E_APP_PORT|E2E_APP_ORIGIN)\b/;

    it.each(CONSUMERS)(
      '$label derives the origin from e2eAppOrigin.ts',
      ({ file, importSpecifier }) => {
        const src = readFileSync(file, 'utf8');
        expect(
          stripBlockComments(src),
          `no \`import … from '${importSpecifier}'\` statement`,
        ).toMatch(importOf(importSpecifier));
        // A stray literal origin here — even alongside the import — is the
        // drift finding 1 flagged: a second, independently-editable copy of the
        // port that the import no longer prevents. `e2eAppOrigin.ts` itself is
        // exempt (it IS the literal).
        expect(src).not.toMatch(STRAY_LITERAL_ORIGIN);
        // And the other shape of the same copy: a local re-declaration. It reds
        // whatever value it holds, so a shadow that agrees with the shared
        // constant today is caught as well as one that has already drifted.
        expect(src, 'a local re-declaration shadows the shared constant').not.toMatch(
          SHADOW_DECLARATION,
        );
      },
    );
  });
});
