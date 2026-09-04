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
 * requires every registry id to resolve its model from inside it, via one of
 * THREE literal signatures: `flowModel('id')`, `resolveModel('id')` — each only
 * counted in a file that also calls `ai.defineFlow`, so a call site that merely
 * reads a model for display (`callables/getImagePrompt.ts`, a prompt-preview
 * callable) cannot stand in for the flow — or a `defineIconFlow({ name: 'id' })`
 * descriptor, the shape `generateCanonIcon`/`generateEquipmentIcon`/
 * `generateKitchenToolIcon` use: they resolve through a variable
 * (`resolveModel(name)` in `defineIconFlow.ts:96`), so the descriptor literal in
 * each flow's OWN file is what stands in for a literal call there.
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
 * One further limit, deliberate: only STATIC relative imports are followed.
 * CF's only dynamic imports are of `sharp` (a bare specifier, in
 * `src/imaging/*`), so nothing local is invisible today — a future
 * `await import('./flows/x.js')` would be.
 *
 * An id resolved through a variable rather than a literal (as `defineIconFlow`
 * does with `resolveModel(name)`) is invisible to the plain call scan on its
 * own — that is why the `defineIconFlow` descriptor is a second, explicit
 * resolution signature above rather than a gap this test just notes and
 * accepts: without it, the three ids built by that factory were pinned only by
 * `getImagePrompt.ts`'s literal calls, a prompt-preview callable that never
 * runs a flow, so the guard could stay green with the flow itself retired
 * (#1249's own defect, reproduced against this guard in review). Every id has
 * a literal site under one of the two shapes today, which the first assertion
 * below pins so this cannot rot into a vacuous pass.
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

const DEFINES_A_FLOW = /\bai\.defineFlow\s*\(/;

/**
 * The files that resolve `flowId`'s model by literal, comments already
 * stripped — under either of the two shapes the header describes.
 *
 * A bare `flowModel('id')`/`resolveModel('id')` call only counts in a file
 * that also calls `ai.defineFlow`: that is what makes the site the flow
 * itself rather than a call site that merely reads the id for something
 * else — `callables/getImagePrompt.ts` resolves every icon id this same way
 * to show an admin the prompt, and is not a flow. The `defineIconFlow`
 * descriptor is checked on its own terms, because the three flows built by
 * that factory never call `resolveModel` with a literal themselves — the
 * descriptor's `name` field is the only literal they have, and it lives in
 * the flow's own file regardless of what `ai.defineFlow` calls it wraps.
 */
function resolutionSites(flowId: string): string[] {
  const call = new RegExp(String.raw`\b(?:flowModel|resolveModel)\s*\(\s*'${flowId}'\s*\)`);
  const iconFlowDescriptor = new RegExp(
    String.raw`defineIconFlow\(\s*\{\s*name:\s*'${flowId}'\s*,`,
  );
  return files.filter((file) => {
    const src = source.get(file) as string;
    if (iconFlowDescriptor.test(src)) return true;
    return call.test(src) && DEFINES_A_FLOW.test(src);
  });
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
      `No \`flowModel('id')\`/\`resolveModel('id')\` literal (in a file that defines a flow) and no ` +
        `\`defineIconFlow({ name: 'id' })\` descriptor found for: ${unresolved.join(', ')}. ` +
        `Either the flow resolves its model through some other indirection — which this guard ` +
        `cannot see, and which needs the scan widened rather than the id excused — or the id is ` +
        `orphaned and belongs out of AI_FLOW_ROLES.`,
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
