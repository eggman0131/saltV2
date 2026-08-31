import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// UT-G1, made mechanical (issue #1135, CLAUDE.md hard rule 12).
//
// A package's `tsconfig.json` is the BUILD config — `rootDir: "src"`,
// `composite`, emits to `dist` — so it can never include `tests/**`. The only
// route in is a separate `noEmit` config NAMED IN THE ROOT `typecheck` SCRIPT,
// and the half that goes wrong is the naming: `packages/ui-components/tsconfig.
// test.json` was added in `84270a98`, was correct, and was invoked by nothing
// for months. UT-G1 said so in prose, in `docs/unit-test-spec.md`, and prose
// caught none of the five directories that drifted out — 526 latent type errors
// across 68k lines of green test code.
//
// So this file asserts the property instead of describing it: every directory
// named `tests` under `packages/**` or `apps/**` that holds TypeScript is
// covered by a tsconfig the root `typecheck` script actually runs. Add a new
// package, or a new `tests/` tree in an existing one, and this goes red on the
// commit that adds it rather than months later.
//
// EXEMPTIONS — one, and the reason travels with it:
//
//   `scripts/tests/` is untyped ESM by design. `scripts/vitest.config.ts` states
//   why beside the `include` that makes it so, and UT-G1's own **Limit**
//   paragraph scopes the rule to TypeScript test directories. It never appears
//   below anyway, because the search roots are `packages/` and `apps/` — but it
//   is named here so the next reader does not "fix" the omission.
//
// NOT exemptions, because they are not `tests/` directories and are already in
// the root script under their own configs: `apps/web-pwa/e2e/` and
// `apps/cloud-functions/probes/`.
//
// NOT covered and deliberately so: `apps/cloud-functions/scripts/`. That is
// issue #1118, a separate open issue on the same theme. This guard must not
// fail on it, and does not — it is not named `tests`.
//
// The limit of what a green here means (UT-G2): it says a compiler reads those
// files, not that everything in them is checked. A `.svelte` import still
// resolves as a bare `Component`, so props passed from a test are not checked;
// that is `svelte-check`'s job. And `.test-d.ts` assertion files ride
// `tsconfig.typetest.json` + a `vitest.config.ts` `typecheck` block instead
// (UT-G4), which this guard says nothing about either way.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

/** Repo-relative POSIX path, so comparisons are platform-independent. */
const rel = (absolute) => path.relative(repoRoot, absolute).split(path.sep).join('/');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.svelte-kit', 'build']);

/** Every directory named `tests` under `root` that holds at least one `.ts`. */
function typeScriptTestDirs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'tests' && holdsTypeScript(full)) found.push(rel(full));
      walk(full);
    }
  };
  walk(path.join(repoRoot, root));
  return found.sort();
}

function holdsTypeScript(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (holdsTypeScript(path.join(dir, entry.name))) return true;
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      return true;
    }
  }
  return false;
}

/** The `tsc -p <config>` arguments the root `typecheck` script really runs. */
function configsInTypecheckScript() {
  const script = JSON.parse(read('package.json')).scripts.typecheck;
  return [...script.matchAll(/tsc\s+-p\s+(\S+)/g)].map((match) => match[1]);
}

/**
 * The directories a config's `include` patterns reach. Only the literal prefix
 * before the first wildcard is used: `tests/**\/*` covers `<configDir>/tests`
 * and everything beneath it. Deliberately conservative on `include` — an
 * exotic glob reads as covering less than it does, so an `include`-side
 * surprise errs towards a false RED, never a false green.
 *
 * NOT conservative on `exclude`: this function reads only `config.include` and
 * never looks at `config.exclude`, so it cannot see a config excluding part of
 * what its `include` names — every one of these ten configs already inherits
 * `"exclude": ["**\/__boundary_tests__/**"]` from `tsconfig.base.json`, unseen
 * by this guard. That is a real, if currently harmless, false-green direction:
 * a `tests/` subtree dropped by `exclude` reads here as covered when the
 * compiler does not actually see it. Stated rather than fixed (CLAUDE.md rule
 * 12) — subtracting `exclude` prefixes is more matching logic for a case that
 * does not fire on this repo today.
 */
function coveredPrefixes(configPath) {
  // A config named in `typecheck` that does not exist on disk must NOT throw
  // here: this runs eagerly in the `describe` body (see below), and an
  // unguarded throw fails collection for the whole file — silently skipping
  // 'names a config for each of them' AND making 'runs every config it names'
  // (which asserts exactly this case) unreachable. Return no coverage instead,
  // so the first test still passes or fails on its own evidence and the
  // config's existence is asserted once, explicitly, by the second test.
  let raw;
  try {
    // `tsconfig.json` allows comments; `JSON.parse` does not. Strip line
    // comments that start a line (the only form these configs use) rather
    // than reaching for a JSON5 dependency.
    raw = read(configPath).replace(/^\s*\/\/.*$/gm, '');
  } catch {
    return [];
  }
  const config = JSON.parse(raw);
  const configDir = path.posix.dirname(configPath.split(path.sep).join('/'));
  return (config.include ?? []).map((pattern) => {
    const literal = pattern.split(/[*?]/)[0];
    return path.posix.normalize(path.posix.join(configDir, literal)).replace(/\/+$/, '');
  });
}

describe('every TypeScript tests/ directory is in the root typecheck script', () => {
  const configs = configsInTypecheckScript();
  const covered = configs.flatMap(coveredPrefixes);
  const testDirs = [...typeScriptTestDirs('packages'), ...typeScriptTestDirs('apps')];

  const isCovered = (dir) =>
    covered.some((prefix) => dir === prefix || dir.startsWith(`${prefix}/`));

  it('finds the test directories at all — a guard that sees nothing passes vacuously', () => {
    // Without this, a bug in the walk above turns the assertion below into
    // `expect([]).toEqual([])` and the guard reports green on a repo it never
    // read. Six trees exist today; the floor is deliberately lower than that so
    // deleting a package is not a false failure.
    expect(testDirs.length).toBeGreaterThanOrEqual(4);
  });

  it('names a config for each of them', () => {
    const uncovered = testDirs.filter((dir) => !isCovered(dir));
    expect(
      uncovered,
      `These tests/ directories are in no tsconfig the root \`typecheck\` script runs, so ` +
        `nothing compiles them (UT-G1). Add a \`tsconfig.test.json\` beside the package's ` +
        `\`tsconfig.json\` and append a \`tsc -p …\` for it to \`package.json\`'s \`typecheck\`:\n  ` +
        uncovered.join('\n  '),
    ).toEqual([]);
  });

  it('runs every config it names — a config that only exists checks nothing', () => {
    // The other half of UT-G1, and the half `ui-components` failed: the file was
    // there and correct, and no script invoked it. A config named here that does
    // not exist would fail `coveredPrefixes` above with ENOENT, which is the
    // point — this test asserts the pairing is complete in both directions.
    for (const config of configs) {
      expect(() => read(config), `${config} is named in \`typecheck\` but does not exist`).not.toThrow();
    }
  });
});
