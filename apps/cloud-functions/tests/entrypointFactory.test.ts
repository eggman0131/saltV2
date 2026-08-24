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

describe('triggers go through the entrypoint factory', () => {
  it('wraps every Firestore and Cloud Tasks trigger in an entrypoint facade', () => {
    const offenders = sources()
      .filter(({ file }) => file !== TRIGGER_FACTORY_FILE)
      .filter(({ code }) => /\b(onDocumentWritten|onTaskDispatched)\s*(<[^>]+>)?\s*\(/.test(code))
      .filter(({ code }) => !/\b(withFirestoreTrigger|withTaskTrigger)\s*[<(]/.test(code))
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
