#!/usr/bin/env node
// The half of the coverage ratchet vitest does not enforce (issue #1133).
//
// Vitest enforces the per-area RATIO floors in `coverage.areas.mjs` natively,
// and has since #943. Two failures get past that, and both of them had already
// happened by the time this was written:
//
// 1. THE RATIO IS BLIND TO A DEDUP. Deleting duplicated, well-covered code
//    removes covered lines from the denominator, so the percentage falls while
//    nothing became less tested — #929/#1113 took `ui-components` from 74.74%
//    to 74.47% with the uncovered branch count sitting at exactly 217 on both
//    sides. The pin was correctly lowered, and the comment at
//    `coverage.areas.mjs` states the test that made it correct: the uncovered
//    count is the invariant. Nothing checked it. Deleting a well-covered
//    duplicate is also the shape of nearly every remaining #913 refactor, so
//    the ratchet's one blind spot pointed straight at the programme it was
//    built to protect. Hence the per-area uncovered-count CEILINGS.
//
// 2. NOBODY BANKS THE GAINS. A floor only ratchets if somebody raises it, and
//    `packages/adapters/firebase-sync/src` sat 34 points above its pin for two
//    months — a PR could have deleted every test #984 and #1084 wrote and
//    landed green. Hence the STALENESS check.
//
// Why a blocking red that prints the block to paste, and not a bot that writes
// it: raising a pin is a deliberate act, and two of the three re-pins before
// #1133 needed judgement a bot cannot supply (#1113 lowered a ratio without
// lowering coverage; #977 corrected a pin that had never been honestly
// measured). A bot would have banked both wrongly. This costs one commit and
// leaves the judgement where it belongs.
//
// A note for anyone who knows vitest's negative thresholds: `lines: -54` does
// mean "at most 54 uncovered lines", and it is genuinely enforced natively. It
// is unusable here because it occupies the same `lines` key as the ratio floor,
// so an entry can carry one or the other and never both — and this issue needs
// both. The extra `uncoveredLines` / `uncoveredBranches` keys are safe on the
// same object: vitest's `resolveGlobThresholds` reads only `lines`, `branches`,
// `functions` and `statements` off a per-glob entry and drops the rest.
//
// Run: pnpm coverage:ratchet:check — AFTER `pnpm test:coverage`, which writes
// the report this reads. Wired into ci.yml's `unit` job beside the file-set
// guard, and gives the same answer locally that it gives there.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `staleAbovePoints` is declared in `coverage.areas.mjs` and not here, beside
// the paragraph that explains why it is a staleness allowance and NOT margin on
// the floor — one declaration, as that file's header requires.
import { coverageAreas, coverageThresholds, staleAbovePoints } from '../coverage.areas.mjs';
import { pinEntry, ratchetFindings, totalsByArea } from './lib/coverageFileSet.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportFile = path.join(repoRoot, 'coverage/unit/coverage-final.json');

// Same reasoning as `check-coverage-files.mjs`: `reportOnFailure` is off, so a
// failing suite writes no report. That run is already red for a better reason,
// and a second failure here would only bury it.
if (!existsSync(reportFile)) {
  console.log(
    `No coverage report at ${path.relative(repoRoot, reportFile)} — nothing to check. ` +
      'Run `pnpm test:coverage` first; if it just failed, fix that instead.',
  );
  process.exit(0);
}

// Istanbul keys the report by absolute path; the area globs are repo-relative.
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const relative = Object.fromEntries(
  Object.entries(report).map(([file, coverage]) => [
    path.relative(repoRoot, file).split(path.sep).join('/'),
    coverage,
  ]),
);

const totals = totalsByArea(relative, coverageAreas);
const findings = ratchetFindings(totals, coverageThresholds, { staleAbove: staleAbovePoints });

const pad = (value, width) => String(value).padStart(width);
console.log(
  `${'area'.padEnd(40)}  ${pad('lines', 6)} ${pad('pin', 6)}  ${pad('unc', 5)} ${pad('max', 5)}` +
    `   ${pad('branch', 6)} ${pad('pin', 6)}  ${pad('unc', 5)} ${pad('max', 5)}`,
);
for (const area of totals) {
  const pin = coverageThresholds[area.glob] ?? {};
  console.log(
    `${area.glob.padEnd(40)}  ${pad(area.lines.pct, 6)} ${pad(pin.lines ?? '—', 6)}  ` +
      `${pad(area.lines.uncovered, 5)} ${pad(pin.uncoveredLines ?? '—', 5)}   ` +
      `${pad(area.branches.pct, 6)} ${pad(pin.branches ?? '—', 6)}  ` +
      `${pad(area.branches.uncovered, 5)} ${pad(pin.uncoveredBranches ?? '—', 5)}`,
  );
}

if (findings.length === 0) {
  console.log(
    '\nCoverage ratchet OK — no area over its uncovered-count ceiling or adrift above its floor.',
  );
  process.exit(0);
}

const affected = [...new Set(findings.map(({ glob }) => glob))];

for (const finding of findings) {
  if (finding.kind === 'ceiling') {
    const delta = finding.uncovered - finding.ceiling;
    console.error(
      `\nERROR: ${finding.glob} left ${delta} more ${finding.metric} untested than it is pinned at ` +
        `(${finding.uncovered} uncovered, ceiling ${finding.ceiling}).` +
        (finding.ratioHeld
          ? `\n  Its ${finding.metric} PERCENTAGE still clears its floor, so this is the case the ` +
            'ratio cannot see. Either the area grew and the new code is untested — write the ' +
            'tests — or it grew and the new code is tested, in which case raising the ceiling by ' +
            'the delta is the honest fix and belongs in the commit message.'
          : `\n  Its ${finding.metric} percentage fell too, so this is a plain regression and ` +
            'vitest is failing it as well. The fix is a test, never a bigger ceiling.'),
    );
  } else {
    console.error(
      `\nERROR: ${finding.glob} is ${(finding.pct - finding.floor).toFixed(2)} points above its ` +
        `${finding.metric} floor (${finding.pct} vs ${finding.floor}), which is more than the ` +
        `${staleAbovePoints.toFixed(2)}-point staleness tolerance. Coverage was earned and never ` +
        'banked, so a later PR could delete those tests and land green.',
    );
  }
}

console.error(
  '\nBank it by replacing these lines in coverage.areas.mjs with today’s measurement:\n\n' +
    totals
      .filter((area) => affected.includes(area.glob))
      .map((area) => pinEntry(area))
      .join('\n') +
    '\n\nThese are exact, floored, vitest-identical figures — paste them, do not retype them. ' +
    'Say in the commit message why each moved; a pin change is a deliberate act, and no pin here ' +
    'may go DOWN to make a build green.',
);

process.exit(1);
