#!/usr/bin/env node
// The rename layer of the weekly duplication sweep. Run: `pnpm dupes:renamed`.
//
// jscpd (via `pnpm dupes`) finds copy-paste. This finds copy-paste-then-rename,
// which jscpd cannot see in either of its modes — the reasoning, and the
// measurement that establishes it, are in `scripts/lib/tokenShingles.mjs`.
//
// Reports pairs of FILES, not regions, deliberately. A renamed clone is almost
// always a whole file that was duplicated and adapted, and pointing at the pair
// is what a reader needs; jscpd already covers "these 30 lines appear twice".
//
// Prints nothing and exits 0 when there is nothing to report, so it is safe to
// run unattended. It never fails on findings — a non-zero exit means the script
// itself broke.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { findRenamedClones, svelteScript, tokenize } from './lib/tokenShingles.mjs';

// The same trees `pnpm dupes` reads, and the same exclusions. Tests are left out
// for the same reason they are in `.jscpd.json`: arrange/assert repetition
// across test files is desirable, and including them buries everything else.
const ROOTS = [
  'apps/web-pwa/src',
  'apps/cloud-functions/src',
  'packages/domain/src',
  'packages/adapters',
  'packages/ui-components/src',
];

const EXCLUDE =
  /(^|\/)(node_modules|dist|coverage|\.svelte-kit|tests|e2e)\/|\.(test|spec)\.ts$|\.d\.ts$/;

// git ls-files rather than a directory walk: it excludes build output and
// anything gitignored without a second ignore list to keep in step.
const tracked = execFileSync('git', ['ls-files', '-z', ...ROOTS], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean)
  .filter((f) => /\.(ts|svelte)$/.test(f) && !EXCLUDE.test(f));

const files = tracked.map((file) => {
  const source = readFileSync(file, 'utf8');
  return {
    path: file,
    tokens: tokenize(path.extname(file) === '.svelte' ? svelteScript(source) : source),
  };
});

const pairs = findRenamedClones(files);

const pct = (n) => `${(n * 100).toFixed(0)}%`;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned: files.length, pairs }, null, 2));
} else if (pairs.length === 0) {
  console.log(`No renamed clones above threshold (${files.length} files scanned).`);
} else {
  console.log(`Renamed clones — ${pairs.length} pair(s) over ${files.length} files scanned:\n`);
  for (const p of pairs) {
    console.log(`  ${pct(p.jaccard)} same / ${pct(p.coverage)} contained`);
    console.log(`    ${p.a}`);
    console.log(`    ${p.b}\n`);
  }
}
