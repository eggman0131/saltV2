#!/usr/bin/env node
// Rejects a font size written as an arbitrary Tailwind value: `text-[10px]`.
//
// The type scale bottoms out at 12px (design.md `typography.label-caps`, mirrored
// in salt.css). Nothing enforced that, so by the #894 architecture review 14 sites
// had written a smaller size by hand; a week later there were 17, two of them
// inside `@salt/ui-components` itself. That is the shape of the whole of issue
// #930: a shared thing exists, does not quite fit, and each call site quietly
// builds its own — and the counts only ever go up, because a sweep buys one clean
// reading and nothing holds it.
//
// Why this and not a lint rule: `eslint.config.js` carries no Tailwind rules, and
// the sizes live in `class="…"` attributes and in `cva`/`cn` string arguments —
// two different syntactic positions, in `.svelte` and `.ts`. A text scan sees both
// for a fraction of the machinery.
//
// ── What it does NOT claim ───────────────────────────────────────────────────
//
// This catches a size written as an ARBITRARY VALUE, which is the only form the
// 17 took and the only one that is unambiguously off-scale. It does not and
// cannot catch a size expressed some other way — an inline `style="font-size:…"`,
// or a bespoke CSS class. Those have never appeared here; if one does, it is
// outside what this check sees, and that is worth saying plainly rather than
// implying a completeness the scan does not have.
//
// Run: pnpm typescale:check   (wired into ci.yml's `static` job)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['packages', 'apps'];
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.svelte-kit',
  'storybook-static',
  'test-results',
  'playwright-report',
]);

/**
 * An arbitrary font size. Only length units, so `text-[--var]`, `text-[#fff]`
 * and `text-[color:var(--x)]` — all legitimate, all common — do not match.
 */
const ARBITRARY_SIZE = /\btext-\[\d*\.?\d+(?:px|rem|em|pt)\]/g;

/** The named rung a sub-12px size should almost always round up to. */
const SCALE_HINT = '`text-xs` (12px) is the smallest rung the scale has.';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(svelte|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => {
  const dir = path.join(REPO_ROOT, r);
  return statSync(dir).isDirectory() ? walk(dir) : [];
});

// Liveness (docs/unit-test-spec.md UT-E2). A scan that has stopped seeing files,
// or stopped seeing Tailwind text utilities at all, reports green over nothing —
// and nothing else in CI would say so.
if (files.length === 0) {
  console.error('typescale:check — the walk found no source files. The scan is broken.');
  process.exit(1);
}
const sources = files.map((file) => ({ file, text: readFileSync(file, 'utf8') }));
if (!sources.some(({ text }) => /\btext-(?:xs|sm|base|lg|xl)\b/.test(text))) {
  console.error('typescale:check — no Tailwind text-size utility found anywhere. The scan is broken.');
  process.exit(1);
}

const offenders = [];
for (const { file, text } of sources) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ARBITRARY_SIZE)) {
      offenders.push(`${path.relative(REPO_ROOT, file)}:${i + 1}  ${m[0]}`);
    }
  });
}

if (offenders.length > 0) {
  console.error(`typescale:check FAILED — ${offenders.length} font size(s) written off-scale:\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(`\n${SCALE_HINT}`);
  console.error('A genuinely new size goes through docs/design/component-tokens.md:');
  console.error('  design.md frontmatter → salt.css → regenerate tokens/*.ts → pin it in');
  console.error('  tokens.theme.test.ts → then consume it. Never a literal at the call site.');
  process.exit(1);
}

console.log(`typescale:check passed — ${files.length} files, no off-scale font sizes.`);
