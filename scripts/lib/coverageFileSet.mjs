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
