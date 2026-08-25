import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The #920 guard: observability flush, telemetry readiness and trace context are
// STRUCTURAL — carried by the entrypoint wrapper every function goes through, not
// repeated per file.
//
// The issue this guards against is not "someone forgot a finally block once". It is
// that all three were conventions applied by hand, and every one of them had already
// decayed by a different amount: at the time #920 was filed `flushServerObservability`
// appeared in 0 of 13 files under callables/ and 12 of 16 under triggers/,
// `whenCfTelemetryReady` in 3, and `runTriggerWithTraceContext` in 2. In a Cloud
// Functions runtime an unflushed buffer is a DROPPED EVENT, so the callable half of
// that meant the spans and error reports of every callable invocation were lost at
// freeze — and a dropped event is invisible: it looks exactly like an event that
// never happened. Nothing failed, so nothing said so.
//
// Adding fourteen `finally` blocks would have fixed the symptom and left the cause.
// So this file asserts the cause is gone: the obligations live in the wrapper, and
// a function that does not go through the wrapper is a test failure rather than a
// silent hole. Same shape as #914's derived DOMAIN_MODULES — the fix for a
// hand-maintained convention is machinery, not a longer list.
//
// Deliberately a SOURCE-level check. firebase-functions folds these options into
// the handler closure and does not surface them on `func.__endpoint`, so there is
// nothing on the built function to assert against; and source is the stronger
// check anyway, because it forbids writing the bare form at all rather than
// observing whatever a built function happens to hold.

const SRC = fileURLToPath(new URL('../src', import.meta.url));

// Where each obligation is allowed to be written by hand. Everywhere else must
// reach it through the wrapper.
const CALLABLE_FACTORY_FILE = 'tracedCallable.ts';
const TRIGGER_FACTORY_FILE = join('triggers', 'triggerEntrypoint.ts');

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

// Several files describe their choice of factory in prose ("onCall (NOT
// onCallGenkit): not a Genkit flow"), which the scanners would otherwise match.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function sources(): { file: string; code: string }[] {
  return tsFilesUnder(SRC).map((file) => ({
    file: file.slice(SRC.length + 1),
    code: stripComments(readFileSync(file, 'utf8')),
  }));
}

describe('callables go through the entrypoint factory', () => {
  it('calls the raw onCall in exactly one file', () => {
    // `makeCallable` owns the only `onCall`. Any other file calling it directly is
    // a callable that skips the auth guard, the report-on-throw catch and — the
    // one that silently loses data — the flush.
    const offenders = sources()
      .filter(({ file }) => file !== CALLABLE_FACTORY_FILE)
      .filter(({ code }) => /\bonCall\s*\(/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('registers every file under callables/ through makeCallable', () => {
    const dir = join(SRC, 'callables');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => {
        const code = stripComments(readFileSync(join(dir, f), 'utf8'));
        // A file that exports no callable at all (a shared helper) is not in scope.
        if (!/export const \w+ = /.test(code)) return false;
        return !code.includes('makeCallable(');
      });

    expect(offenders).toEqual([]);
  });

  it('finds enough callables to prove the scan is live', () => {
    // A scanner that silently matches nothing is the classic false-green. Derived
    // from the tree rather than a hand-maintained counter, so adding a callable
    // cannot leave a stale number behind.
    const registrations = sources().filter(({ code }) => code.includes('makeCallable(')).length;
    const files = readdirSync(join(SRC, 'callables')).filter((f) => f.endsWith('.ts')).length;

    expect(registrations).toBeGreaterThanOrEqual(files - 1);
  });
});

const WRAPPER = /\b(withFirestoreTrigger|withTaskTrigger)\s*[<(]/;

/**
 * The body of the `export function` declaration whose signature starts at
 * `signatureStart` (the `<` or `(` that follows its name), by matching braces from
 * its opening `{`. Returns undefined for any shape this scanner does not
 * understand — the SAFE direction: an export it cannot read is simply not excused,
 * which fails loudly rather than widening the allowance in silence.
 */
function bodyOfExportedFunction(code: string, signatureStart: number): string | undefined {
  let cursor = signatureStart;
  // Step over a generic parameter list first, so a `(` or `{` written inside one
  // is not mistaken for the parameter list or for the body.
  if (code[cursor] === '<') {
    let angle = 0;
    for (; cursor < code.length; cursor += 1) {
      if (code[cursor] === '<') angle += 1;
      else if (code[cursor] === '>') {
        angle -= 1;
        if (angle === 0) {
          cursor += 1;
          break;
        }
      }
    }
  }
  const close = (open: number, opener: string, closer: string): number => {
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === opener) depth += 1;
      else if (code[i] === closer) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  };

  const paramsOpen = code.indexOf('(', cursor);
  if (paramsOpen === -1) return undefined;
  const paramsClose = close(paramsOpen, '(', ')');
  if (paramsClose === -1) return undefined;
  const bodyOpen = code.indexOf('{', paramsClose);
  if (bodyOpen === -1) return undefined;
  const bodyClose = close(bodyOpen, '{', '}');
  return bodyClose === -1 ? undefined : code.slice(bodyOpen, bodyClose + 1);
}

/**
 * LOCAL trigger facades, derived from the tree. A file under `triggers/` that
 * exports a function whose body calls the wrapper IS an entrypoint facade: it
 * applies the wrapper on behalf of every call site, exactly as `tracedCallable.ts`
 * does for callables. A registration reaching the wrapper through one of these is
 * wrapped, and the scan below must see that.
 *
 * Derived rather than named here (UT-E1): `timerWriteTrigger` (#987) is the first,
 * and a hand-written allowance would have to be extended by whoever writes the
 * second — which is precisely the maintenance this file exists to remove.
 *
 * Scoped to each exported function's OWN BODY, never to the file. A file-scoped
 * match reads "this file mentions the wrapper somewhere" and hands the excuse to
 * every name the file exports — which would enrol the pure predicates that live
 * beside a registration (`iconNeedsGeneration`, `kitNeedsInference`) and this
 * file's own `timerKey`. The cost is not cosmetic: `onCanonItemWritten.ts` CALLS
 * `iconNeedsGeneration`, so with those names in the list, deleting its
 * `withFirestoreTrigger` wrapper — the exact regression this file exists to catch
 * — would leave the scan below green. The liveness anchor cannot see that: an
 * over-broad list is non-empty by construction.
 */
function localTriggerFacades(): string[] {
  return sources()
    .filter(({ file }) => file.startsWith('triggers/') && file !== TRIGGER_FACTORY_FILE)
    .flatMap(({ code }) =>
      [...code.matchAll(/export\s+function\s+(\w+)\s*[<(]/g)]
        .filter((m) =>
          WRAPPER.test(bodyOfExportedFunction(code, (m.index ?? 0) + m[0].length - 1) ?? ''),
        )
        .map((m) => m[1] as string),
    );
}

describe('triggers go through the entrypoint factory', () => {
  it('derives local trigger facades from the tree rather than a hand-written list', () => {
    // The liveness anchor (UT-E2). A derivation that silently collapsed to nothing
    // would make the scan below excuse nobody — which looks like a pass — while a
    // facade-registered trigger sails through unwrapped. If the last local facade
    // is ever inlined away, this expectation goes with it, deliberately by hand.
    expect(localTriggerFacades()).toContain('timerWriteTrigger');

    // The other half of live: not too WIDE either. `timerKey` is exported from the
    // same file and is a pure key-builder; it can only appear here if the scoping
    // has slipped back to the file, which would start excusing whatever an
    // ordinary trigger file happens to call. Named because it is that file's own
    // sibling export — no list to maintain elsewhere.
    expect(localTriggerFacades()).not.toContain('timerKey');
  });

  it('wraps every Firestore and Cloud Tasks trigger in an entrypoint facade', () => {
    const facades = localTriggerFacades();
    const viaFacade = new RegExp(`\\b(?:${facades.join('|')})\\s*[<(]`);

    const offenders = sources()
      .filter(({ file }) => file !== TRIGGER_FACTORY_FILE)
      .filter(({ code }) => /\b(onDocumentWritten|onTaskDispatched)\s*(<[^>]+>)?\s*\(/.test(code))
      .filter(({ code }) => !WRAPPER.test(code) && !viaFacade.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('leaves no trigger flushing, awaiting readiness or installing trace context by hand', () => {
    // The wrapper does all three. A trigger doing any of them itself is either a
    // duplicate (harmless but drifting) or — worse — evidence someone reintroduced
    // the per-file convention this issue removed.
    const HAND_ROLLED =
      /\b(flushServerObservability|whenCfTelemetryReady|runTriggerWithTraceContext)\s*\(/;
    const offenders = sources()
      .filter(({ file }) => file.startsWith('triggers/'))
      .filter(({ file }) => file !== TRIGGER_FACTORY_FILE)
      .filter(({ code }) => HAND_ROLLED.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('finds enough triggers to prove the scan is live', () => {
    const wrapped = sources().filter(({ code }) =>
      /\b(withFirestoreTrigger|withTaskTrigger)\s*[<(]/.test(code),
    ).length;

    // 12 triggers plus the factory itself at the time of writing; the floor is set
    // below that so adding one never needs this number touched, while a scan that
    // collapses to nothing still fails.
    expect(wrapped).toBeGreaterThanOrEqual(10);
  });
});
