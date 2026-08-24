import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every function definition must pin `memory` AND `region` INLINE (issues #883,
// #919).
//
// `setGlobalOptions({ region: 'europe-west2', memory: '512MiB' })` sits at
// index.ts:100, but firebase-functions bakes global options into each function's
// `__endpoint` EAGERLY at definition time, and ES imports evaluate before that
// line runs. So a module imported at the top of index.ts — which is every
// trigger, callable, auth hook and scheduled job in this directory — never sees
// the global and silently falls to the platform defaults. index.ts says so in
// prose; nothing enforced it.
//
// 256MiB does not cover this repo's module-init baseline (firebase-admin +
// Genkit + OTel + posthog-node). The trap has landed three times: chefChat OOMed
// at "263 MiB used, 7 over"; onEquipmentManifestWritten was killed after
// authoring its first equipment brief, stranding every other item with no
// description to review and no icon to draw; and snapshotVolumetrics was one
// collection scan away from the same. Each was found in production logs, which
// is the expensive way to find them.
//
// `region` is the SAME trap with a quieter symptom and is guarded here as of
// #919: an unpinned module deploys to `us-central1` while the rest of Salt lives
// in `europe-west2`. Nothing OOMs — the function simply runs on the wrong
// continent, adding a round trip to every Firestore read, and the two
// task-queue triggers additionally build a `locations/{region}/functions/{name}`
// resource name that has to agree with where their dispatch handler actually
// deployed. A cross-region mismatch there is a task that enqueues and never
// arrives. That was previously guarded by nothing at all.
//
// Deliberately a SOURCE scan, not an endpoint assertion: the failure mode is a
// NEW file that forgets the pin, and a test with a hand-maintained import list
// would miss precisely that file. Nothing here imports the functions, so the
// guard stays free of their module-init cost.
//
// ─── Nothing below is hand-listed (#919) ─────────────────────────────────────
//
// The previous version carried a twelve-name regex of firebase-functions
// factories and a one-name `FACTORY` exclusion. Both had already fallen behind:
// `makeTracedCallable` (#415) defines callables and was not in the list, and
// #920 added `makeCallable` underneath it, so by the time anyone looked there
// were two invisible factories, not one. A hand-maintained list that can fall
// behind IS the defect (#914's `DOMAIN_MODULES` established the rule), so both
// lists are now derived from the tree:
//
//   • The firebase-functions half comes from what this codebase actually
//     IMPORTS from `firebase-functions*`, narrowed to the `onX` / `beforeX`
//     naming every v2 trigger factory uses. A factory nobody imports cannot
//     define anything; one somebody imports tomorrow is picked up the same day.
//   • The local half comes from the tree too: a file that exports a `make*`
//     function and calls a firebase-functions factory inside it IS a definition
//     factory. Its exported names join the scan, and the file itself is excused
//     from pinning — its options come from its callers, each of which this scan
//     checks in its own right. Pinning inside a factory would silently override
//     what a caller asked for.
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Pinned to a literal (`'512MiB'`) or to an imported constant (`COOK_TIMER_REGION`). */
const MEMORY_PIN = /\bmemory:\s*['"A-Za-z_$]/;
const REGION_PIN = /\bregion:\s*['"A-Za-z_$]/;

// A call to a named factory, allowing the explicit type argument the task-queue
// triggers carry: `onTaskDispatched<CookTimerTaskPayload>(`. The old guard's
// `\bname\s*\(` did not, so all three `*Dispatch` triggers were invisible to it —
// a blind spot nobody had written down, found by the deployment-surface check
// below rather than by reading.
const CALL_OF = '\\b';
const CALL = '\\s*(?:<[^>()]*>)?\\s*\\(';

/** Comments mention `onCall(` all over this codebase; only real code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

const sources = new Map(
  sourceFiles(SRC).map((path) => [
    path.slice(SRC.length + 1),
    stripComments(readFileSync(path, 'utf8')),
  ]),
);

/**
 * Every `onX` / `beforeX` binding imported from `firebase-functions` anywhere in
 * `src/`. That is the whole set of platform factories this codebase can define a
 * function with: a definition needs an import, and an import names its binding.
 */
function importedPlatformFactories(): Set<string> {
  const names = new Set<string>();
  const IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'(firebase-functions[^']*)'/g;
  for (const code of sources.values()) {
    for (const [, clause] of code.matchAll(IMPORT)) {
      for (const specifier of clause.split(',')) {
        // `onCall as callable` binds the local name; `type Foo` is not a value.
        const parts = specifier.trim().split(/\s+as\s+/);
        const local = (parts[1] ?? parts[0] ?? '').trim();
        if (/^(on|before)[A-Z]/.test(local)) names.add(local);
      }
    }
  }
  return names;
}

const PLATFORM_FACTORIES = importedPlatformFactories();

/**
 * Local wrappers around those factories: a file exporting `make*` whose body
 * calls a platform factory. Returns the file → its exported factory names.
 */
function localFactories(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const usesPlatform = (code: string) =>
    [...PLATFORM_FACTORIES].some((name) => new RegExp(`${CALL_OF}${name}${CALL}`).test(code));
  for (const [file, code] of sources) {
    if (!usesPlatform(code)) continue;
    const exported = [...code.matchAll(/export\s+function\s+(make[A-Z]\w*)/g)].map(
      (m) => m[1] as string,
    );
    if (exported.length > 0) found.set(file, exported);
  }
  return found;
}

const LOCAL_FACTORIES = localFactories();

/** Everything that can define a deployed function, platform or local. */
const DEFINITION = new RegExp(
  `${CALL_OF}(?:${[...PLATFORM_FACTORIES, ...[...LOCAL_FACTORIES.values()].flat()].join('|')})${CALL}`,
);

function defines(code: string): boolean {
  return DEFINITION.test(code);
}

/**
 * The deployment surface: every module `index.ts` re-exports a function from.
 * `index.ts` IS the manifest — a function not exported from it does not exist —
 * so this is the honest denominator for "did the scan see everything?".
 */
function deployedModules(): string[] {
  const index = sources.get('index.ts') as string;
  const paths = new Set<string>();

  // `export { onCookTimerWrite } from './triggers/onCookTimerWrite.js';`
  for (const [, spec] of index.matchAll(/export\s*\{[^}]*\}\s*from\s*'\.\/([^']+)'/g)) {
    paths.add((spec as string).replace(/\.js$/, '.ts'));
  }
  // `export { onRecipeWritten };` — re-exporting a name imported further up.
  for (const [, clause] of index.matchAll(/export\s*\{([^}]*)\}\s*;/g)) {
    for (const name of (clause as string)
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)) {
      const imported = index.match(
        new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'\\.\\/([^']+)'`),
      );
      if (imported) paths.add((imported[1] as string).replace(/\.js$/, '.ts'));
    }
  }
  return [...paths];
}

describe('function option pins', () => {
  it('derives the factory set from the tree rather than a hand-written list', () => {
    // Guards the derivation. If either half silently collapsed, every scan below
    // would pass vacuously — the exact shape of the defect this was rewritten to
    // remove. Checked against the DEPLOYMENT SURFACE rather than a threshold:
    // every module index.ts re-exports a function from must look, to this scan,
    // like a module that defines one.
    const blind = deployedModules().filter((file) => !defines(sources.get(file) ?? ''));
    expect(deployedModules().length).toBeGreaterThan(20);
    expect(blind, `index.ts deploys these, but the scan sees no definition in them`).toEqual([]);

    // The two the old hand-list had already missed.
    const local = [...LOCAL_FACTORIES.values()].flat();
    expect(local).toContain('makeCallable');
    expect(local).toContain('makeTracedCallable');
  });

  it.each([
    ['memory', MEMORY_PIN],
    ['region', REGION_PIN],
  ])('every file defining a function pins %s inline', (option, pin) => {
    const unpinned = [...sources]
      .filter(([file]) => !LOCAL_FACTORIES.has(file))
      .filter(([, code]) => defines(code) && !pin.test(code))
      .map(([file]) => file);

    expect(
      unpinned,
      `these define a function but inherit the platform default \`${option}\`: ${unpinned.join(', ')}`,
    ).toEqual([]);
  });

  it('index.ts sets its globals BEFORE the functions that rely on them', () => {
    // index.ts is the one file allowed to lean on `setGlobalOptions`, because its
    // callables are defined INLINE, below the call — ES module evaluation order
    // makes that sound where a top-level import is not. That is only true while
    // the call really does come first, and the old file-level scan could not see
    // the difference: it passed on the mere PRESENCE of a `memory:` key anywhere
    // in the file, which is how nine call sites came to be "covered" by one
    // unrelated line.
    const code = sources.get('index.ts') as string;
    const globals = code.indexOf('setGlobalOptions(');
    expect(globals, 'index.ts no longer calls setGlobalOptions').toBeGreaterThan(-1);

    const globalCall = code.slice(globals, code.indexOf(')', globals));
    expect(MEMORY_PIN.test(globalCall), 'setGlobalOptions no longer sets memory').toBe(true);
    expect(REGION_PIN.test(globalCall), 'setGlobalOptions no longer sets region').toBe(true);

    const early = [...code.matchAll(new RegExp(DEFINITION.source, 'g'))]
      .filter((m) => (m.index ?? 0) < globals)
      .map((m) => m[0]);
    expect(early, 'these are defined before setGlobalOptions runs and miss both globals').toEqual(
      [],
    );
  });

  it('sees through comments and spots a missing pin', () => {
    // Guards the guard. A regex that quietly stopped matching, or a comment
    // stripper that ate real code, would make the scans above vacuously green.
    const commentOnly = '// onCall (NOT onCallGenkit): this is not a Genkit flow.\n';
    expect(defines(stripComments(commentOnly))).toBe(false);

    const unpinned = 'export const x = onCall({ timeoutSeconds: 30 }, async () => {});';
    expect(defines(stripComments(unpinned))).toBe(true);
    expect(MEMORY_PIN.test(unpinned)).toBe(false);
    expect(REGION_PIN.test(unpinned)).toBe(false);

    const viaFactory = "export const x = makeCallable({ options: { memory: '512MiB' } });";
    expect(defines(stripComments(viaFactory))).toBe(true);

    // A constant is a pin; only an absent key is not.
    expect(REGION_PIN.test('{ region: COOK_TIMER_REGION }')).toBe(true);
    expect(MEMORY_PIN.test("{ memory: '512MiB' }")).toBe(true);
  });
});
