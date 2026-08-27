#!/usr/bin/env node
// Checks the "Docs map" table in docs-map.md against the repository as it
// actually is. Three questions, all of them file-system facts rather than
// judgement, which is exactly why they belong in a script and not in a model:
//
//   1. Does every doc the map links to still exist?
//   2. Does every `Tracks` glob still match at least one tracked file?
//   3. Does every doc on disk appear somewhere in the map?
//
// (3) is the one that matters most and the one no per-PR review can see: the
// map is the ONLY index of `docs/`, which is not auto-loaded, so a doc missing
// from it is invisible to every agent — it is not merely undiscoverable, it may
// as well not exist. (1) and (2) catch the same rot from the other direction,
// after a file moves or a package is renamed.
//
// The map remains the single source of truth. This script PARSES it; it keeps
// no copy of the table and knows nothing about which doc covers what.
//
// Run: pnpm docsmap:check   (wired into ci.yml's `static` job)

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The map lives at the repo root, not in `docs/`, so that every path in it
// stays repo-root-relative — an agent can open a row's link verbatim, and
// GitHub renders it. It moved out of CLAUDE.md (which is auto-loaded into every
// agent and subagent) because it is a lookup table consulted once per task, not
// a rule that has to be resident.
const mapFile = 'docs-map.md';

// Docs that must appear in the map. `docs/**` is the whole point of the map;
// the one file outside it is called out by its own row today, and is listed
// here so that moving or dropping that row is caught rather than silently
// losing the only pointer to it.
const REQUIRED_IN_MAP = [(f) => f.startsWith('docs/') && f.endsWith('.md'), (f) => f === 'infra/bigquery-export/README.md'];

const errors = [];
const warnings = [];
const fail = (where, message) => errors.push({ where, message });

/** Every file git knows about — the right universe to glob against, since it
 *  excludes node_modules and build output without needing an ignore list. */
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

/** The "Docs map" section: everything up to the next level-2 heading. The
 *  heading is the H1 of its own file today and was a `##` inside CLAUDE.md
 *  before the move, so accept either. The design docs live in a `###`
 *  subsection, so they are deliberately included. */
function extractSection(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^#{1,2}\s+Docs map/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { lines: lines.slice(start, end), offset: start };
}

const source = readFileSync(path.join(repoRoot, mapFile), 'utf8');
const section = extractSection(source);
if (!section) {
  console.error(`${mapFile}: no "Docs map" heading found — the map is the routing source for doc review and for every agent; it cannot go missing.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Every local link target in the section resolves to a real file.
// ---------------------------------------------------------------------------
// Covers the table's `Read this` column, the cross-references in `When`, the
// design-docs bullets, and the prose pointer at the workflow — anything the
// map claims you can go and read.
const linkTargets = new Set();
section.lines.forEach((line, i) => {
  for (const [, target] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const filePath = target.split('#')[0];
    if (!filePath) continue;
    linkTargets.add(filePath);
    if (!existsSync(path.join(repoRoot, filePath))) {
      fail(`${mapFile}:${section.offset + i + 1}`, `links to \`${filePath}\`, which does not exist. If it moved, update the link; if it was deleted, remove the row.`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Every row still routes: at least one of its `Tracks` globs matches.
// ---------------------------------------------------------------------------
// A row that matches nothing is worse than no row at all: it reads as though
// the doc is covered, while nothing routes to it — and that is the state this
// check exists to make impossible.
//
// The rule is per ROW, not per glob, because a row may legitimately pre-declare
// the shape of work that has not landed yet. `docs/formulas-schedules-batches.md`
// is the standing example: its own `When` cell opens "**Not yet built (Epic
// #778)**", and it tracks `process/**`, `batch/**` and `culture/**` alongside
// the `formula/**` that does exist, so the doc is wired up in advance of the
// directories. Failing on those would punish exactly the foresight the map
// wants. A dead glob inside a still-live row is reported as a warning: worth
// seeing, not worth blocking a PR that did not cause it.
const tableRows = section.lines
  .map((line, i) => ({ line, lineNo: section.offset + i + 1 }))
  .filter(({ line }) => line.trimStart().startsWith('|'))
  .map(({ line, lineNo }) => ({ cells: line.split('|').slice(1, -1).map((c) => c.trim()), lineNo }))
  .filter(({ cells }) => cells.length >= 3)
  // Drop the header row and its `---|---|---` separator.
  .filter(({ cells }) => cells[0] !== 'Read this' && !/^-+$/.test(cells[0].replace(/\s/g, '')));

if (tableRows.length === 0) {
  fail(mapFile, 'the Docs map table has no rows — it was probably reformatted in a way this parser cannot read. Fix the table or this script, but do not leave the map unchecked.');
}

for (const { cells, lineNo } of tableRows) {
  const doc = cells[0].match(/\]\(([^)\s]+)\)/)?.[1] ?? cells[0];
  const globs = [...cells[1].matchAll(/`([^`]+)`/g)].map(([, g]) => g.trim()).filter(Boolean);

  if (globs.length === 0) {
    fail(`${mapFile}:${lineNo}`, `row for \`${doc}\` has no Tracks glob, so nothing routes to it. Give it a glob or drop the row.`);
    continue;
  }

  const dead = globs.filter((glob) => !trackedFiles.some((f) => path.matchesGlob(f, glob)));
  if (dead.length === globs.length) {
    fail(
      `${mapFile}:${lineNo}`,
      `row for \`${doc}\` routes nothing — none of its Tracks globs (${dead.map((g) => `\`${g}\``).join(', ')}) matches a tracked file. Fix the glob, or drop the row if the code it tracked is gone.`,
    );
  } else if (dead.length > 0) {
    warnings.push(`${mapFile}:${lineNo} — row for \`${doc}\` has ${dead.length} glob(s) matching nothing: ${dead.map((g) => `\`${g}\``).join(', ')}. Fine if the code is not built yet; stale otherwise.`);
  }
}

// ---------------------------------------------------------------------------
// 3. Every doc on disk appears somewhere in the map.
// ---------------------------------------------------------------------------
for (const file of trackedFiles) {
  if (!REQUIRED_IN_MAP.some((matches) => matches(file))) continue;
  if (linkTargets.has(file)) continue;
  fail(file, `is not mentioned anywhere in ${mapFile}. Neither \`docs/\` nor the map itself is auto-loaded, so a doc missing from the map is invisible to every agent — add a row (or a bullet, for a design doc).`);
}

// ---------------------------------------------------------------------------

for (const warning of warnings) console.warn(`  warning: ${warning}`);

if (errors.length === 0) {
  console.log(`Docs map OK — ${tableRows.length} rows, ${linkTargets.size} link targets, every row routing${warnings.length ? `, ${warnings.length} warning(s) above` : ''}.`);
  process.exit(0);
}

console.error(`Docs map check failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n`);
for (const { where, message } of errors) console.error(`  ${where}\n    ${message}\n`);
process.exit(1);
