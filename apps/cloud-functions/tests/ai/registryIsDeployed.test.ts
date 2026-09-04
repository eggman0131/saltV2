/**
 * The registry's OTHER direction (issue #1249, CLAUDE.md rule 12).
 *
 * `AI_FLOW_ROLES` is the single source of truth for which model each AI job
 * runs on, and /admin/app-settings renders its keys directly: the "Used by:"
 * line on each role card, and a per-flow override field under Advanced. #935
 * made that generated rather than hand-written so the card could not fall
 * BEHIND the registry — a deployed flow missing from the list.
 *
 * Nothing checked the inverse: a key in the registry naming a job the app never
 * runs. `categoriseRecipe` was exactly that. It was registered as if it were
 * deployed, had no callable, no trigger and no client caller, and its only
 * invocation anywhere was a hand-run operator script — so an admin reading the
 * Fast card, or changing its override, got an answer that did not describe the
 * running system. #1249 retired it; this test is what stops the next one.
 *
 * ── What is asserted, and on what evidence ──────────────────────────────────
 *
 * Firebase deploys what `src/index.ts` exports, so a module no import path
 * reaches from `index.ts` is not in the deployed bundle at all. The test builds
 * that reachable set by walking static import specifiers from `index.ts`, then
 * requires every registry id to resolve its model — `flowModel('id')` or
 * `resolveModel('id')`, the only two signatures that accept one — from inside
 * it.
 *
 * This is a source scan: it reads bytes off disk and never imports the modules
 * it checks, so the CF unit-test convention of stubbing `defineFlow` and
 * `resolveModel` cannot make it vacuously green. `stripComments` runs first, so
 * a flow id mentioned in prose (several are, as tier precedents) is not
 * evidence of anything.
 *
 * ── Boundary of the claim ───────────────────────────────────────────────────
 *
 * Reachability is not invocation. A flow imported by `index.ts` but wired to no
 * callable and no trigger would pass this test — proving it ships, not that
 * anything calls it. Catching that needs the export/trigger graph, which is a
 * bigger instrument than the defect warrants; what is pinned here is the case
 * that actually occurred, where the module was in no deployed bundle at all.
 *
 * Two further limits, both deliberate:
 *   - only STATIC relative imports are followed. CF's only dynamic imports are
 *     of `sharp` (a bare specifier, in `src/imaging/*`), so nothing local is
 *     invisible today — a future `await import('./flows/x.js')` would be.
 *   - an id resolved through a variable rather than a literal (as
 *     `defineIconFlow.ts` does with `resolveModel(name)`) is not seen by the
 *     literal scan. Every id has a literal site as well today, which the first
 *     assertion below pins so this cannot rot into a vacuous pass.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { AI_FLOW_IDS } from '@salt/domain/schemas';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const entrypoint = join(srcDir, 'index.ts');

/** Every `.ts` file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const files = walk(srcDir);
const source = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

// `from './x.js'`, a bare `import './x.js'`, and `import('./x.js')` alike. Only
// relative specifiers — a bare one is a package, never a file in this tree.
const RELATIVE_SPECIFIER = /(?:from|import)\s*\(?\s*'(\.[^']+)'/g;

/** NodeNext resolution, in reverse: the `.js` a TS import names is a `.ts` here. */
function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  return [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

/** Everything `src/index.ts` pulls in, transitively — i.e. what gets deployed. */
function reachableFromEntrypoint(): Set<string> {
  const seen = new Set<string>();
  const queue = [entrypoint];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of (source.get(file) ?? '').matchAll(RELATIVE_SPECIFIER)) {
      // Group 1 is the whole of the alternation-free capture, so a match has it.
      const target = resolveSpecifier(file, match[1] as string);
      if (target !== undefined && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/** The files that resolve `flowId`'s model by literal, comments already stripped. */
function resolutionSites(flowId: string): string[] {
  const call = new RegExp(String.raw`\b(?:flowModel|resolveModel)\s*\(\s*'${flowId}'\s*\)`);
  return files.filter((file) => call.test(source.get(file) as string));
}

const deployed = reachableFromEntrypoint();
const rel = (file: string): string => relative(srcDir, file);

describe('every registered AI flow ships in the deployed bundle', () => {
  // Self-tests first: the two ways this guard could pass while measuring nothing.
  it('scans a real tree and reaches a real entrypoint', () => {
    expect(existsSync(entrypoint)).toBe(true);
    expect(files.length).toBeGreaterThan(50);
    // A concrete deep import, so a walk that resolved nothing cannot look green.
    expect([...deployed].map(rel)).toContain(join('flows', 'chefChat.ts'));
    expect(deployed.size).toBeGreaterThan(files.length / 2);
  });

  it('finds a literal model-resolution site for every registry id', () => {
    const unresolved = AI_FLOW_IDS.filter((flowId) => resolutionSites(flowId).length === 0);
    expect(
      unresolved,
      `No \`flowModel('id')\`/\`resolveModel('id')\` literal found for: ${unresolved.join(', ')}. ` +
        `Either the flow resolves its model through a variable — which this guard cannot see, ` +
        `and which needs the scan widened rather than the id excused — or the id is orphaned ` +
        `and belongs out of AI_FLOW_ROLES.`,
    ).toEqual([]);
  });

  it.each(AI_FLOW_IDS)('%s resolves its model inside the deployed bundle', (flowId) => {
    const sites = resolutionSites(flowId);
    expect(
      sites.filter((file) => deployed.has(file)).map(rel),
      `\`${flowId}\` is in AI_FLOW_ROLES, so /admin/app-settings lists it as a job the app runs ` +
        `and offers a per-flow model override for it — but it only resolves a model in ` +
        `${sites.map(rel).join(', ') || '(nowhere)'}, which no import path reaches from ` +
        `src/index.ts. Firebase deploys what index.ts exports, so that code is not in any ` +
        `deployed function. Give it a real caller, or take the id out of the registry ` +
        `(see the categoriseRecipe retirement note in appSettings.ts).`,
    ).not.toEqual([]);
  });
});
