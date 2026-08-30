#!/usr/bin/env node
// Writes this run's slice of the policy-twin register to a file the sweep agent
// reads, and names the slice on stdout so the step summary can say which pairs
// the week actually examined.
//
// Usage: node scripts/duplication-pair-slice.mjs <runNumber> <outFile>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { parsePairs, sliceForRun } from './lib/duplicationPairs.mjs';

const [runNumber = '0', outFile = '.dupe-sweep/pairs.md'] = process.argv.slice(2);

const register = readFileSync('.github/duplication-pairs.md', 'utf8');
const entries = parsePairs(register);
const slice = sliceForRun(entries, Number(runNumber));

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  [
    `# This run's slice of the policy-twin register`,
    ``,
    `Entries ${slice.map((e) => `#${e.number}`).join(' and ')} of ${entries.length}.`,
    `Read ONLY these. The rest of the register comes round on later runs.`,
    ``,
    ...slice.map((e) => e.text),
  ].join('\n'),
);

// Consumed by the workflow for $GITHUB_STEP_SUMMARY.
console.log(slice.map((e) => `#${e.number} ${e.title}`).join(' | '));
