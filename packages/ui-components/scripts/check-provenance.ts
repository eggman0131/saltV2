// spec: SPEC.md §3.8 v0.2.3
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = join(PKG_ROOT, 'src');

const SCAN_DIRS = ['headless', 'primitives', 'lib'];

// §3.8: .svelte files use <!-- spec: ... --> and .ts/.svelte.ts files use // spec: ...
const SVELTE_HEADER = /^<!-- spec: [\w.-]+\.md §[^\s,]+(?:,\s*§[^\s,]+)* v\d+\.\d+(\.\d+)? -->/;
const TS_HEADER = /^\/\/ spec: [\w.-]+\.md §[^\s,]+(?:,\s*§[^\s,]+)* v\d+\.\d+(\.\d+)?/;

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.endsWith('.svelte') || entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

function checkFile(file: string): string | null {
  const content = readFileSync(file, 'utf8');
  const firstLine = content.split('\n')[0] ?? '';
  const isSvelte = file.endsWith('.svelte');
  const pattern = isSvelte ? SVELTE_HEADER : TS_HEADER;
  return pattern.test(firstLine) ? null : relative(REPO_ROOT, file);
}

const missing: string[] = [];
for (const dir of SCAN_DIRS) {
  const full = join(SRC_ROOT, dir);
  for (const file of collectFiles(full)) {
    const err = checkFile(file);
    if (err) missing.push(err);
  }
}

if (missing.length > 0) {
  console.error('Provenance header missing in:');
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Provenance check passed — all files have headers.');
