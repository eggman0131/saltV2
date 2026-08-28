// spec: ui-spec-v02.md §3.8 v0.2.17
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

// Provenance header check (§3.8, amended by issue #919).
//
// Two things this used to do, and no longer does, because both were the same
// defect wearing different clothes — a checker that covered part of its surface
// and reported green over the rest:
//
//  1. It scanned a HAND-WRITTEN list of three directories (`headless`,
//     `primitives`, `lib`), which was the whole of `src/` on the day it was
//     written. `layout/` and `templates/` were added later and never joined the
//     list, so 29 files sat outside a CI gate — and 13 of them had no header at
//     all. The scan is now the TREE: everything under `src/`, minus the one
//     directory that exists to be rejected by lint.
//  2. It checked the SHAPE of the cited document (`[\w.-]+\.md`) and never that
//     the document exists. 170 of 223 files cited `SPEC.md`, which has never
//     existed in this repo — the spec was split into `ui-spec-v02.md` …
//     `ui-spec-v11.md` and §3.8 kept the old single-file name. A citation you
//     cannot follow is decoration, so the document is now RESOLVED against
//     `docs/design/`.
//
// And a third, the same defect one level down (issue #976). Resolving the
// DOCUMENT and not the `§` after it left the checker green over eleven
// citations naming a section that does not exist in the file they name — and
// four of those were not stale cross-references but placeholders for a
// specification nobody had written. `EmptyState`, `ErrorState`, `FormPage` and
// `DetailPage` shipped, and grew ~34 consuming files, pointing at v0.2 §8.25 /
// §8.26 / §9.2 / §9.3, where v0.2's §8 stops at 8.15 and its §9 is the
// Changelog. The section is now resolved too, against the headings PARSED from
// the cited document — never a list maintained beside it, which is the defect
// #919 was about.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = join(PKG_ROOT, 'src');
// Where a cited document is looked up. `docs/design/` holds the UI specs almost
// every header names; `docs/` is there because `Markdown.svelte` legitimately
// cites `ai-kitchen-assistant.md`, which is a repo doc that is not a UI spec.
const SPEC_DIRS = [join(REPO_ROOT, 'docs/design'), join(REPO_ROOT, 'docs')];

// Deliberate lint violations, not generated components. They exist to be
// rejected by `pnpm boundary:test`, and a spec section that sanctions one would
// be a contradiction in terms.
const NOT_COMPONENTS = ['__boundary_tests__'];

// `<!-- spec: BODY -->` for .svelte, `// spec: BODY` for .ts — the header itself.
// BODY is picked apart below rather than matched in one expression, so the error
// message can say WHICH half is wrong.
const SVELTE_HEADER = /^<!-- spec: (.+) -->$/;
const TS_HEADER = /^\/\/ spec: (.+)$/;

// One citation: `<doc>.md §X.Y[, §Z] vM.m[.p][ (note)]`. Several are separated
// by `; ` — a file may implement two specs (ListPage is v0.4 plus v0.5's fill
// mode), which two files had already been writing before §3.8 admitted it.
const CITATION = /^([\w.-]+\.md) (§[^\s,]+(?:,\s*§[^\s,]+)*) v\d+\.\d+(?:\.\d+)?(?: \([^)]*\))?$/;

/**
 * Every section of a document that a header may cite, derived from its own
 * `#` headings and nothing else — add a heading and the citation resolves the
 * same day.
 *
 * A heading yields up to three keys, because both numbering styles are in use
 * across `docs/`:
 *
 *  - its leading dotted number — `## 8.23.8 The static chips` → `8.23.8`,
 *    `# 9. Changelog` → `9`. This is how every `ui-spec-*.md` is cited.
 *  - its text — `## Typography` → `typography`, which is the only way to cite
 *    `design.md` and `ai-kitchen-assistant.md`, whose headings are unnumbered.
 *  - its text with a trailing parenthetical dropped — `## Surfaces (web-pwa)`
 *    → `surfaces`, so a qualifier added to a heading does not silently break
 *    the citations already pointing at it.
 *
 * A cited section can never contain a space (CITATION splits on it), so a
 * multi-word heading is only citable by its number. That is a property of the
 * header format, not a hole here.
 */
function sectionsOf(file: string): Set<string> {
  const sections = new Set<string>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (!heading) continue;
    const text = (heading[1] as string).trim();
    const numbered = /^(\d+(?:\.\d+)*)\.?(?:\s|$)/.exec(text);
    if (numbered) sections.add(numbered[1] as string);
    const named = text.replace(/`/g, '').toLowerCase().trim();
    sections.add(named);
    sections.add(named.replace(/\s*\([^)]*\)\s*$/, '').trim());
  }
  return sections;
}

const sectionCache = new Map<string, Set<string> | null>();

/** The cited document's sections, or null when no such document exists. */
function sectionsFor(doc: string): Set<string> | null {
  const cached = sectionCache.get(doc);
  if (cached !== undefined) return cached;
  const dir = SPEC_DIRS.find((d) => existsSync(join(d, doc)));
  const sections = dir ? sectionsOf(join(dir, doc)) : null;
  sectionCache.set(doc, sections);
  return sections;
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_COMPONENTS.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.endsWith('.svelte') || entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** The problem with this file's header, or null when it has none. */
function checkFile(file: string): string | null {
  const firstLine = readFileSync(file, 'utf8').split('\n')[0] ?? '';
  const isSvelte = file.endsWith('.svelte');
  const header = (isSvelte ? SVELTE_HEADER : TS_HEADER).exec(firstLine);
  if (!header) {
    const shape = isSvelte
      ? '<!-- spec: <doc>.md §X.Y vM.m.p -->'
      : '// spec: <doc>.md §X.Y vM.m.p';
    return `no provenance header on line 1 (expected \`${shape}\`)`;
  }

  for (const citation of (header[1] as string).split(';').map((c) => c.trim())) {
    const parts = CITATION.exec(citation);
    if (!parts) return `malformed citation: \`${citation}\``;
    const doc = parts[1] as string;
    const sections = sectionsFor(doc);
    if (!sections) {
      return `cites \`${doc}\`, which is not a document in docs/design/ or docs/`;
    }
    for (const cited of (parts[2] as string).split(',')) {
      const section = cited.trim().replace(/^§/, '');
      if (!sections.has(section.toLowerCase())) {
        return `cites \`${doc} §${section}\`, but that document has no section \`${section}\``;
      }
    }
  }
  return null;
}

const problems: string[] = [];
for (const file of collectFiles(SRC_ROOT)) {
  const problem = checkFile(file);
  if (problem) problems.push(`${relative(REPO_ROOT, file)} — ${problem}`);
}

if (problems.length > 0) {
  console.error(`Provenance check failed in ${problems.length} file(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `Provenance check passed — ${collectFiles(SRC_ROOT).length} files, every header naming a real section of a real spec.`,
);
