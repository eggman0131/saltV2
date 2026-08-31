// Set arithmetic behind `scripts/check-coverage-files.mjs`, kept apart from the
// IO so it can be unit-tested without first producing a coverage report.
//
// `path.matchesGlob` rather than a dependency: the globs in `coverage.areas.mjs`
// use only `*`, `**` and `{a,b}`, which Node matches with the same semantics
// vitest's own globber does. `scripts/check-docs-map.mjs` matches globs the same
// way for the same reason.

import path from 'node:path';

const matchesAny = (file, globs) => globs.some((glob) => path.matchesGlob(file, glob));

/**
 * The files the coverage globs name, out of the files git actually tracks.
 * Tracked files are the right universe: they exclude `node_modules` and build
 * output without needing an ignore list of our own.
 */
export function expectedCoverageFiles(trackedFiles, { include, exclude }) {
  return trackedFiles
    .filter((file) => matchesAny(file, include) && !matchesAny(file, exclude))
    .sort();
}

/**
 * How the report and the globs disagree.
 *
 * `missing` is the failure this whole guard exists for: a file the globs name
 * that never reached the report, which means it left the denominator instead of
 * counting as 0%. `unexpected` is the mirror image and is split by whether git
 * tracks the file, because an untracked one is a local working-tree artefact
 * rather than a broken glob.
 */
export function diffCoverageFiles(expected, actual, trackedFiles) {
  const inReport = new Set(actual);
  const named = new Set(expected);
  const tracked = new Set(trackedFiles);
  const extra = actual.filter((file) => !named.has(file)).sort();

  return {
    missing: expected.filter((file) => !inReport.has(file)),
    unexpected: extra.filter((file) => tracked.has(file)),
    untracked: extra.filter((file) => !tracked.has(file)),
  };
}

/** How many files sit behind each per-area floor. */
export function countByArea(files, areas) {
  return areas.map((glob) => ({
    glob,
    count: files.filter((file) => path.matchesGlob(file, glob)).length,
  }));
}

// ---------------------------------------------------------------------------
// The arithmetic behind `scripts/check-coverage-ratchet.mjs` (issue #1133)
// ---------------------------------------------------------------------------
// Everything below reproduces what VITEST enforces, deliberately and to the
// last decimal, because a check that disagreed with the thing it is guarding
// would be worse than none: it would red a PR vitest calls green, or print a
// replacement pin that fails the moment it is pasted.
//
// The source of truth is vitest's `BaseCoverageProvider.checkThresholds`, which
// compares `coverageMap.getCoverageSummary().data[metric].pct` against the pin.
// That summary is istanbul-lib-coverage's, so:
//   - a LINE is a statement's start line, hit-counted by the MAXIMUM of the
//     statements starting on it (`FileCoverage.getLineCoverage`);
//   - a BRANCH is one arm, counted flat across every entry in `b`;
//   - an area's figure is the sum of its files' totals, percentaged once at the
//     end (`CoverageSummary.merge`) — never an average of per-file percentages.

/**
 * Istanbul's percentage, which FLOORS to two decimals rather than rounding
 * (`percent()` in istanbul-lib-coverage). Rounding reads a hundredth high on
 * six of this repo's eight areas, and a pin a hundredth high is a red build.
 */
export function coveragePercent(covered, total) {
  return total > 0 ? Math.floor((covered / total) * 10000) / 100 : 100;
}

/** Hits per source line: the max over the statements starting on that line. */
function lineHits(fileCoverage) {
  const hits = new Map();
  for (const [id, count] of Object.entries(fileCoverage.s)) {
    const entry = fileCoverage.statementMap[id];
    if (!entry) continue;
    const { line } = entry.start;
    if (!hits.has(line) || hits.get(line) < count) hits.set(line, count);
  }
  return [...hits.values()];
}

const metric = (covered, total) => ({
  covered,
  total,
  uncovered: total - covered,
  pct: coveragePercent(covered, total),
});

/**
 * Per-area line and branch totals from an istanbul-shaped report, keyed by
 * REPO-RELATIVE path — the caller converts, because istanbul keys its report
 * absolutely and every glob in `coverage.areas.mjs` is relative.
 *
 * Buckets by `path.matchesGlob` exactly as `countByArea` above does, so an area
 * holds the same files here as it does in the file-set guard.
 */
export function totalsByArea(fileCoverages, areas) {
  return areas.map((glob) => {
    let lc = 0;
    let lt = 0;
    let bc = 0;
    let bt = 0;
    let files = 0;

    for (const [file, fileCoverage] of Object.entries(fileCoverages)) {
      if (!path.matchesGlob(file, glob)) continue;
      files += 1;

      const lines = lineHits(fileCoverage);
      lt += lines.length;
      lc += lines.filter((hits) => hits > 0).length;

      for (const arms of Object.values(fileCoverage.b)) {
        bt += arms.length;
        bc += arms.filter((hits) => hits > 0).length;
      }
    }

    return { glob, files, lines: metric(lc, lt), branches: metric(bc, bt) };
  });
}

/** The pin field holding each metric's uncovered-count ceiling. */
const CEILING_KEY = { lines: 'uncoveredLines', branches: 'uncoveredBranches' };

// Hundredths, as integers. `89.14 - 88.03 > 1` is true in binary floating point
// and so is `1.0000000000000142 > 1`, which is how a tolerance of exactly one
// point starts firing on an area sitting exactly one point clear.
const hundredths = (n) => Math.round(n * 100);

/**
 * Everything wrong with an area, as data — the printing lives in the script.
 *
 * Two kinds, because they are two different failures and neither subsumes the
 * other (issue #1133):
 *
 *   - `ceiling`: the area left MORE lines or branches untested than it was
 *     pinned at. This is the one a ratio structurally cannot see, because
 *     deleting well-covered code moves the ratio without moving the testing —
 *     the #929/#1113 case written up in `coverage.areas.mjs`.
 *   - `stale`: the area sits more than `staleAbove` points ABOVE its floor, so
 *     coverage was earned and never banked. A red, not a warning, because the
 *     ratchet's regression half has been mechanical since #943 while its
 *     ratcheting half was remembered — and remembering failed for 34 points in
 *     the one area #941 named as the sharpest risk.
 *
 * An area with no pin is skipped, not defaulted: `coverage.areas.mjs` leaves
 * two areas deliberately unfloored and inventing a ceiling for them here would
 * put a second, silent declaration next to the one that file exists to be.
 */
export function ratchetFindings(areaTotals, thresholds, { staleAbove }) {
  const findings = [];

  for (const area of areaTotals) {
    const pin = thresholds[area.glob];
    if (!pin) continue;

    for (const name of ['lines', 'branches']) {
      const { pct, uncovered } = area[name];
      const ceiling = pin[CEILING_KEY[name]];
      const floor = pin[name];

      if (typeof ceiling === 'number' && uncovered > ceiling) {
        findings.push({
          kind: 'ceiling',
          glob: area.glob,
          metric: name,
          uncovered,
          ceiling,
          // Which SHAPE this is, so the message can say whether raising the
          // ceiling is legitimate. A count that rose while the ratio held or
          // rose is an area that grew; a count that rose while the ratio fell
          // is a plain regression, and vitest is failing it too.
          ratioHeld: typeof floor !== 'number' || hundredths(pct) >= hundredths(floor),
        });
      }

      if (
        typeof floor === 'number' &&
        hundredths(pct) - hundredths(floor) > hundredths(staleAbove)
      ) {
        findings.push({ kind: 'stale', glob: area.glob, metric: name, pct, floor });
      }
    }
  }

  return findings;
}

/**
 * The entry to paste into `coverage.areas.mjs` for an area, at today's
 * measurement. Generated rather than hand-typed because a replacement pin that
 * is a hundredth off is a red build, and this is the only place those numbers
 * are ever written down for a human to copy.
 *
 * Emitted in the exploded form PRETTIER produces at `printWidth: 100`, not on
 * one line: a single-line entry is correct JavaScript that `pnpm format:check`
 * rejects, so a paste would go red for a reason that has nothing to do with
 * coverage.
 */
export function pinEntry(area) {
  return [
    `  '${area.glob}': {`,
    `    lines: ${area.lines.pct},`,
    `    branches: ${area.branches.pct},`,
    `    uncoveredLines: ${area.lines.uncovered},`,
    `    uncoveredBranches: ${area.branches.uncovered},`,
    '  },',
  ].join('\n');
}
