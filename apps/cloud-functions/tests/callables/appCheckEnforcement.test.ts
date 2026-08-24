import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every callable must take its App Check setting from the ONE shared constant
// (issue #718). This test is the guard that makes that structurally true.
//
// It exists because it had already stopped being true: `APP_CHECK_ENFORCEMENT`
// was introduced as the single flip site, and then six callables under
// src/callables/ were each written with their own `enforceAppCheck: false`
// literal. Nothing failed, so nobody noticed — "flip one line to enforce" had
// quietly become "flip one line and hope you find the other six". Under
// enforcement that drift is not cosmetic: a callable left on a stale literal is
// an unprotected hole in exactly the AI cost surface App Check exists to guard.
//
// Deliberately a SOURCE-level check, not a runtime one. firebase-functions folds
// `enforceAppCheck` into the onCall handler's closure and never surfaces it on
// `func.__endpoint` (see optionsToEndpoint), so the built function does not expose
// it to assert against. Source is also the stronger check: it forbids re-adding a
// literal at all, rather than merely observing whatever value it holds.

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

// The callable registration sites this test scans. As of #920 the raw `onCall`
// belongs to `makeCallable` alone (asserted in tests/entrypointFactory.test.ts),
// so App Check reaches every handler callable through the factory. What remains to
// check HERE are the sites that still pass their own options object: the
// `onCallGenkit` flows, and `makeCallable`'s own onCall inside tracedCallable.ts.
const CALLABLE_FACTORY = /(onCallGenkit|makeTracedCallable|makeCallable|onCall)\s*\(/g;

// Floor for the number of call sites found, DERIVED rather than hand-maintained:
// one per file under callables/ that exports a callable, plus the onCallGenkit
// flows in index.ts. A scanner that silently matches nothing is the classic
// false-green, so a sweep that finds implausibly little must fail. Deriving it
// means adding a callable cannot leave a stale literal behind (the drift #919 is
// about, and the same shape #914 fixed in DOMAIN_MODULES).
const MIN_EXPECTED_CALL_SITES = readdirSync(join(SRC, 'callables')).filter((f) =>
  f.endsWith('.ts'),
).length;

// The two App Check constants a callable may spread. Enforcement is the default;
// the exemption is the sign-in pair only (#718 Phase 4).
const ENFORCED = '...APP_CHECK_ENFORCEMENT';
const EXEMPT = '...APP_CHECK_SIGN_IN_EXEMPT';

// The complete list of callables allowed to be App Check EXEMPT. This is the point
// of the constant: the exemption is enumerable, and widening it is a deliberate act
// that fails this test rather than a comment nobody reads. Do not add to this list
// to make a build pass — an unattested callable is an open door onto the AI spend
// App Check exists to protect. Phase 4 empties it.
const SIGN_IN_EXEMPT_FILES = ['callables/requestEmailOtp.ts', 'callables/verifyEmailOtp.ts'];

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

// Strip comments before scanning. Several files describe their choice of factory
// in prose ("onCall (NOT onCallGenkit): not a Genkit flow"), which the factory
// regex would otherwise match as a call site.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// Read the balanced `{...}` options object starting at `from`, or null when the
// first argument is not an object literal (e.g. the 1-argument onCallGenkit form,
// which takes no options at all and therefore declares no App Check setting).
function optionsObjectAt(source: string, from: number): string | null {
  const open = source.indexOf('{', from);
  if (open === -1 || source.slice(from, open).trim() !== '') return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  return null;
}

interface CallSite {
  readonly file: string;
  readonly factory: string;
  readonly options: string | null;
}

function callSites(): CallSite[] {
  return tsFilesUnder(SRC).flatMap((file) => {
    const source = stripComments(readFileSync(file, 'utf8'));
    const found: CallSite[] = [];
    for (const match of source.matchAll(CALLABLE_FACTORY)) {
      const from = match.index + match[0].length;
      found.push({
        file: file.slice(SRC.length + 1),
        factory: match[1]!,
        options: optionsObjectAt(source, from),
      });
    }
    return found;
  });
}

describe('the enforcement value itself', () => {
  // Evaluated at module load, so each case needs a fresh import under a fresh env.
  async function enforcementUnder(emulator: string | undefined): Promise<boolean> {
    vi.resetModules();
    const previous = process.env['FUNCTIONS_EMULATOR'];
    if (emulator === undefined) delete process.env['FUNCTIONS_EMULATOR'];
    else process.env['FUNCTIONS_EMULATOR'] = emulator;
    try {
      const mod = await import('../../src/tracedCallable.js');
      return mod.APP_CHECK_ENFORCEMENT.enforceAppCheck;
    } finally {
      if (previous === undefined) delete process.env['FUNCTIONS_EMULATOR'];
      else process.env['FUNCTIONS_EMULATOR'] = previous;
    }
  }

  // The one that matters. Every deployed environment — dev, staging, prod — runs
  // with FUNCTIONS_EMULATOR unset, so this is the value real users get. If the
  // emulator gate is ever broadened (say to a truthy check that some CI runner
  // also satisfies), enforcement would silently switch off in production and
  // nothing else in the suite would notice.
  it('enforces when FUNCTIONS_EMULATOR is unset (every deployed environment)', async () => {
    await expect(enforcementUnder(undefined)).resolves.toBe(true);
  });

  // Only the literal 'true' the emulator sets disables it — matching the existing
  // FUNCTIONS_EMULATOR checks elsewhere in this app.
  it('relaxes only under the emulator', async () => {
    await expect(enforcementUnder('true')).resolves.toBe(false);
    await expect(enforcementUnder('false')).resolves.toBe(true);
  });
});

describe('App Check enforcement is defined in exactly one place', () => {
  it('finds every callable call site', () => {
    // Guards the scanner itself: if the regex or the walk breaks, the assertion
    // below would vacuously pass over an empty list.
    expect(callSites().length).toBeGreaterThanOrEqual(MIN_EXPECTED_CALL_SITES);
  });

  it('spreads one of the shared App Check constants at every options-carrying callable', () => {
    // Only sites that pass their own options object have anything to spread. The
    // handler callables go through makeCallable, which applies the constant for
    // them — that is the #920 change, and tests/entrypointFactory.test.ts is what
    // stops a callable being written any other way.
    const offenders = callSites()
      // tracedCallable.ts is where the constant is APPLIED (`{ ...appCheck,
      // ...options }`), so it spreads a parameter rather than the named constant.
      // The "no enforceAppCheck literal outside this file" case below is what
      // guards its content.
      .filter((site) => site.file !== 'tracedCallable.ts')
      // Only the raw firebase-functions factories take an options object that could
      // carry App Check. A makeCallable/makeTracedCallable config does not — the
      // factory applies the constant on its behalf, which is the #920 change.
      .filter((site) => site.factory === 'onCall' || site.factory === 'onCallGenkit')
      .filter((site) => site.options !== null)
      .filter((site) => !(site.options?.includes(ENFORCED) || site.options?.includes(EXEMPT)))
      .map((site) => site.file);

    // Named rather than counted, so a failure says which file to fix.
    expect(offenders).toEqual([]);
  });

  it('grants the sign-in exemption to exactly the two OTP callables', () => {
    // Post-#920 the exemption is named as `appCheck: APP_CHECK_SIGN_IN_EXEMPT` in a
    // makeCallable config rather than spread into an options literal, so match the
    // constant by name wherever it appears.
    const exempt = tsFilesUnder(SRC)
      .filter((file) =>
        stripComments(readFileSync(file, 'utf8')).includes('APP_CHECK_SIGN_IN_EXEMPT'),
      )
      .map((file) => file.slice(SRC.length + 1))
      .filter((file) => file !== 'tracedCallable.ts');

    // Both directions matter. An UNEXPECTED file here is a new unattested callable;
    // a MISSING one means the sign-in pair silently became enforced, which is the
    // Phase 4 change and must not arrive as a side effect of an unrelated edit.
    expect(exempt.sort()).toEqual([...SIGN_IN_EXEMPT_FILES].sort());
  });

  it('declares no enforceAppCheck literal outside the shared constant', () => {
    const constantSource = 'tracedCallable.ts';
    const offenders = tsFilesUnder(SRC)
      .filter((file) => !file.endsWith(constantSource))
      .filter((file) => stripComments(readFileSync(file, 'utf8')).includes('enforceAppCheck'))
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});
