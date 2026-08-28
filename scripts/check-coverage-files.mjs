#!/usr/bin/env node
// Checks that the coverage report just written measured EVERY file the globs in
// `coverage.areas.mjs` name — no more, no fewer.
//
// Why that needs checking at all (issue #974). `@vitest/coverage-v8` accounts
// for files no test loaded by transforming each one and remapping it through a
// JavaScript parser. When that parse fails, `remapCoverage` logs a stack trace
// and returns `{}` — so the file is dropped from the report entirely rather than
// counted as 0%. The denominator quietly shrinks, and nothing fails.
//
// That is precisely the failure mode the per-area ratchet exists to prevent: a
// floor is only as trustworthy as the file set behind it. 37 files were being
// dropped this way on every run, local and CI, for as long as the floors had
// existed — so the pins were self-consistent but nobody could say what they were
// pinned over. The moment a file started or stopped parsing, an area would move
// for no reason a diff could explain.
//
// This makes that impossible rather than merely fixed: a dropped file is now a
// red build naming the file, not 10 lines of noise above the coverage table.
//
// Run: pnpm coverage:files:check  — AFTER `pnpm test:coverage`, which writes the
// report this reads. Wired into ci.yml's `unit` job, next to the run that
// produces it.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coverageAreas, coverageExclude, coverageInclude } from '../coverage.areas.mjs';
import { countByArea, diffCoverageFiles, expectedCoverageFiles } from './lib/coverageFileSet.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Written by the `json` reporter in vitest.config.ts. Istanbul's canonical
// machine-readable output: one key per file that reached the report.
const reportFile = path.join(repoRoot, 'coverage/unit/coverage-final.json');

// No report means the suite never got far enough to write one — `reportOnFailure`
// is off, so a single failing test skips report generation. That run is already
// red for a better reason, and a second failure here would only bury it. Say what
// happened and stand down.
if (!existsSync(reportFile)) {
  console.log(
    `No coverage report at ${path.relative(repoRoot, reportFile)} — nothing to check. ` +
      'Run `pnpm test:coverage` first; if it just failed, fix that instead.',
  );
  process.exit(0);
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const expected = expectedCoverageFiles(trackedFiles, {
  include: coverageInclude,
  exclude: coverageExclude,
});

// Istanbul keys the report by absolute path; every other set here is
// repo-relative, which is also what reads well in an error message.
const measured = Object.keys(JSON.parse(readFileSync(reportFile, 'utf8')))
  .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
  .sort();

const { missing, unexpected, untracked } = diffCoverageFiles(expected, measured, trackedFiles);

const errors = [];

if (missing.length > 0) {
  errors.push(
    `${missing.length} file(s) named by coverage.include never reached the report, so they are ` +
      'outside the denominator rather than counted as 0%. The usual cause is a parse failure ' +
      'during remapping — search the `pnpm test:coverage` output for "Failed to parse". Either ' +
      'make the file measurable, or exclude it deliberately in coverage.areas.mjs:\n' +
      missing.map((file) => `  - ${file}`).join('\n'),
  );
}

if (unexpected.length > 0) {
  errors.push(
    `${unexpected.length} tracked file(s) are in the report but match no coverage.include glob. ` +
      'The globs and the report disagree; fix coverage.areas.mjs:\n' +
      unexpected.map((file) => `  - ${file}`).join('\n'),
  );
}

for (const { glob, count } of countByArea(expected, coverageAreas)) {
  console.log(`${String(count).padStart(4)}  ${glob}`);
}
console.log(`${String(expected.length).padStart(4)}  total measured`);

if (untracked.length > 0) {
  console.log(
    `\nNote: ${untracked.length} file(s) were measured but are not tracked by git. Not a failure — ` +
      'commit them or clean them up:\n' +
      untracked.map((file) => `  - ${file}`).join('\n'),
  );
}

if (errors.length > 0) {
  console.error(`\n${errors.join('\n\n')}`);
  process.exit(1);
}

console.log('\nCoverage file set matches coverage.areas.mjs exactly.');
