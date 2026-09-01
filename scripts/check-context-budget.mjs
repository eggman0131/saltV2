#!/usr/bin/env node
// Caps the size of the instruction files that are AUTO-LOADED into every agent.
//
// CLAUDE.md is not a doc you go and read — it is a tax on every session and every
// subagent, paid before a line of code is read. It grew 2.3 KB → 43.6 KB between
// April and August 2026, doubling in the final four weeks, because each feature PR
// added a paragraph and nothing ever pushed one back out. Trimming it once buys a
// month; a ceiling is what actually holds.
//
// The ceiling is not a style rule — it forces the placement question at the moment
// someone is about to add. Over budget, the fix is almost never "write it shorter":
//
//   - Does the code already say it? Put it in a comment at the declaration and
//     link to that. (Rule 3's storage keys, the host-guard rationale.)
//   - Is it needed only inside one package? Nested CLAUDE.md — those load when an
//     agent works in that tree, not before. (apps/cloud-functions/CLAUDE.md.)
//   - Is it looked up per task rather than held in mind? A doc plus a row in
//     docs-map.md. (docs/data-model.md, and the map itself.)
//   - Only if none of those fit does it belong here.
//
// Budgets are bytes, chosen as roughly 20% headroom over the real size at the time
// they were set — enough for a genuine new invariant, tight enough that a fourth
// essay has to displace something. RAISING A BUDGET IS A DECISION, not a fix for a
// red check: if the content genuinely has to be resident, say why in the PR.
//
// Run: pnpm context:check   (wired into ci.yml's `static` job)

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The root contract is loaded everywhere, so it gets the tightest scrutiny.
const ROOT_BUDGET = 24_000;
// A nested CLAUDE.md is only paid by agents working in that tree. Still bounded:
// "it is nested" is not a licence to write an essay.
const NESTED_BUDGET = 12_000;

const claudeFiles = execFileSync('git', ['ls-files', '-z', '*CLAUDE.md', 'CLAUDE.md'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter((f) => !f.startsWith('.claude/'))
  .sort();

if (!claudeFiles.includes('CLAUDE.md')) {
  console.error(
    'CLAUDE.md is not tracked at the repo root — the architecture contract cannot go missing.',
  );
  process.exit(1);
}

const rows = claudeFiles.map((file) => {
  const bytes = existsSync(path.join(repoRoot, file))
    ? Buffer.byteLength(readFileSync(path.join(repoRoot, file)))
    : 0;
  const budget = file === 'CLAUDE.md' ? ROOT_BUDGET : NESTED_BUDGET;
  return { file, bytes, budget, over: bytes > budget };
});

const width = Math.max(...rows.map((r) => r.file.length));
for (const { file, bytes, budget, over } of rows) {
  const pct = Math.round((bytes / budget) * 100);
  console.log(
    `  ${file.padEnd(width)}  ${String(bytes).padStart(6)} / ${budget}  (${pct}%)${over ? '  ← OVER' : ''}`,
  );
}

// ~4 chars per token is the usual rule of thumb; it is a scale cue for the reader,
// not an accounting figure, so it is deliberately not what the check compares.
const total = rows.reduce((n, r) => n + r.bytes, 0);
console.log(
  `\n  ${rows.length} auto-loaded file(s), ${total} bytes total (~${Math.round(total / 4 / 100) / 10}k tokens if every one loads).`,
);

const over = rows.filter((r) => r.over);
if (over.length === 0) process.exit(0);

console.error('\nContext budget exceeded:\n');
for (const { file, bytes, budget } of over) {
  console.error(
    `  ${file} is ${bytes} bytes, over its ${budget}-byte budget by ${bytes - budget}.`,
  );
}
console.error(
  `
Do not just reword it shorter. Ask where the content belongs:

  the code already says it   → a comment at the declaration, and link to it
  one package needs it       → a nested CLAUDE.md in that package
  looked up once per task    → a doc under docs/, plus a row in docs-map.md
  a resident invariant       → it stays, and something else has to move out

Raising the budget in ${path.basename(fileURLToPath(import.meta.url))} is a
decision to make deliberately and justify in the PR, not a way to get to green.
`,
);
process.exit(1);
