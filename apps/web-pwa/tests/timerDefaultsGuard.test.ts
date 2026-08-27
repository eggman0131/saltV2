/**
 * Source guard: nothing re-declares a timer default (issues #842, #994).
 *
 * `lib/timerDefaults.ts` exists because three screens can start a timer — plain
 * cook mode, guided cook and My Kitchen — and all three must offer the same
 * default and arm the same push backstop. Guided cook nonetheless shipped with
 * its own `NOTIFY_MIN_MINUTES = 1.5`, `AD_HOC_TIMER_LABEL` and
 * `AD_HOC_TIMER_MINUTES`, held in agreement by a comment asking the next author
 * to keep them identical. #994 deleted those copies in favour of the import;
 * this is what stops the next one appearing.
 *
 * The failure it prevents is SILENT. A drifted floor does not throw, does not
 * log, and does not fail a page test: a timer started from the wrong screen
 * simply, quietly, never pushes. Nothing else in CI would say so.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The guarded identifiers are read out of `timerDefaults.ts` itself, so
 *    renaming or adding an export moves the guard with it. There is no list to
 *    maintain here (UT-E1).
 *  - The scan surface is the whole of `src`, walked — not a list of pages. A
 *    fourth screen that starts a timer is covered on the day it is written
 *    (UT-E1).
 *  - It asserts on IDENTIFIERS and on the import, never on the wording of the
 *    comments beside them and never on a line number (UT-E3). Both are things
 *    #994 itself rewrote.
 *  - It proves it can still see (UT-E2): the walk must find the file the drift
 *    was in, the export list must be non-empty, and the re-declaration matcher
 *    is exercised against a synthetic copy so a broken regex fails here rather
 *    than passing everything.
 *
 * It is a genuine source scan — it reads bytes off disk and never imports the
 * modules it checks, so no `vi.mock` can make it agree.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');
const defaultsPath = join(srcDir, 'lib/timerDefaults.ts');

/** Every source file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!entry.isFile()) return [];
    return entry.name.endsWith('.ts') || entry.name.endsWith('.svelte') ? [full] : [];
  });
}

// Strip comments so a MENTION of a constant in prose — which is exactly how the
// two copies justified themselves to each other — never counts either way.
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** What `timerDefaults` exports, read from the module rather than restated. */
const GUARDED: readonly string[] = [
  ...stripComments(readFileSync(defaultsPath, 'utf8')).matchAll(
    /^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm,
  ),
].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

/** A local binding of that name — the drift this guard exists to catch. */
function redeclares(code: string, name: string): boolean {
  return new RegExp(String.raw`\b(?:const|let|var|function|class|enum)\s+${name}\b`).test(code);
}

const references = (code: string, name: string): boolean =>
  new RegExp(String.raw`\b${name}\b`).test(code);

// Any import of the shared module, however the path is spelled or where from.
const IMPORTS_DEFAULTS = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*timerDefaults(?:\.js)?['"]/;

interface Scanned {
  readonly path: string;
  readonly code: string;
}

const files: Scanned[] = walk(srcDir)
  .filter((path) => path !== defaultsPath)
  .map((path) => ({
    path: relative(srcDir, path).split(sep).join('/'),
    code: stripComments(readFileSync(path, 'utf8')),
  }));

describe('timer defaults are declared once', () => {
  it('exports a non-empty set of names to guard', () => {
    // If this regex ever stops matching, every assertion below passes trivially.
    expect(GUARDED.length).toBeGreaterThan(0);
    expect(GUARDED).toContain('AD_HOC_TIMER_LABEL');
    expect(GUARDED).toContain('AD_HOC_TIMER_MINUTES');
    expect(GUARDED).toContain('NOTIFY_MIN_MINUTES');
  });

  it('can still see the source it guards', () => {
    // Not an inventory — an anchor. A walk that narrowed, or a page that moved
    // out from under the guard, fails here instead of going quietly green.
    expect(files.map((f) => f.path.split('/').pop())).toContain('GuidedCookPage.svelte');
    expect(files.length).toBeGreaterThan(1);
  });

  it('recognises a re-declaration when it sees one', () => {
    // The exact shape #994 deleted, as a string — so a regex broken by a future
    // edit fails on this synthetic case rather than on nothing at all.
    expect(redeclares('  const NOTIFY_MIN_MINUTES = 1.5;', 'NOTIFY_MIN_MINUTES')).toBe(true);
    expect(redeclares("  const AD_HOC_TIMER_LABEL = 'Salt Timer';", 'AD_HOC_TIMER_LABEL')).toBe(
      true,
    );
    expect(redeclares('  shouldNotifyFor(entry.durationMinutes)', 'shouldNotifyFor')).toBe(false);
  });

  it('has no file outside lib/timerDefaults.ts declaring one of them', () => {
    const offenders = files.flatMap((file) =>
      GUARDED.filter((name) => redeclares(file.code, name)).map((name) => `${file.path}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has every file that uses one importing it from the shared module', () => {
    const consumers = files.filter((file) => GUARDED.some((name) => references(file.code, name)));
    // A screen that starts a timer must exist, or the scan is measuring nothing.
    expect(consumers.length).toBeGreaterThan(0);

    const unsourced = consumers.flatMap((file) => {
      const imported = IMPORTS_DEFAULTS.exec(file.code)?.[1] ?? '';
      return GUARDED.filter(
        (name) => references(file.code, name) && !references(imported, name),
      ).map((name) => `${file.path}: ${name}`);
    });
    expect(unsourced).toEqual([]);
  });
});
