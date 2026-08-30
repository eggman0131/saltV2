/**
 * Source guard: no flow may declare a `z.custom()` output schema (issue #932,
 * Phase 6).
 *
 * `z.custom<T>()` with NO validator function accepts any value at all — it is a
 * type assertion wearing a schema's clothes. Three recipe flows declared their
 * `outputSchema` that way, so Genkit validated nothing on the way out and a
 * malformed draft reached the production `recipes` collection unchallenged, via
 * an `httpsCallable<…, RecipeDoc>` cast and a full-document `setDoc`.
 *
 * That this guard is worth having rests on Genkit actually enforcing
 * `outputSchema`, which was verified against the installed version (1.41.0)
 * rather than assumed: a flow whose handler returns a value violating its
 * declared output schema throws `INVALID_ARGUMENT: Schema validation failed`.
 * So a real schema here is a real gate, and `z.custom()` is a real hole.
 *
 * A source scan, deliberately, and for the reason `aiTimeoutGuard.test.ts`
 * gives: the CF test convention replaces `ai.defineFlow` with
 * `(_config, handler) => handler`, which DISCARDS the config object entirely.
 * No unit test that invokes a flow can therefore observe its `outputSchema` at
 * all, and a guard built on one would be vacuously green. This reads bytes off
 * disk and never imports the modules it checks.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every `.ts` file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

// Strip comments so this very file's prose — and any explanatory comment
// mentioning `z.custom` — never counts as a declaration.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// `z.custom(` with a validator argument is legitimate — it validates. The hole
// is the NO-ARGUMENT form, with or without a type parameter.
const BARE_Z_CUSTOM = /\bz\.custom\s*(<[^>]*>)?\s*\(\s*\)/;

const files = walk(srcDir).map((path) => ({
  path: relative(srcDir, path).split(sep).join('/'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

describe('flow output schemas', () => {
  it('scans a non-trivial number of source files', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it('declares no bare `z.custom()` anywhere in cloud-functions source', () => {
    const offenders = files.filter((f) => BARE_Z_CUSTOM.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('gives all three recipe flows a real, schema-derived output contract', () => {
    // Named explicitly: these are the three #932 Phase 6 converted, and the ones
    // whose output reaches a production collection.
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['flows/authorRecipe.ts', 'AuthorRecipeOutputSchema'],
      ['flows/extractRecipeFromUrl.ts', 'ExtractRecipeFromUrlOutputSchema'],
      ['flows/extractRecipeFromPhoto.ts', 'ExtractRecipeFromPhotoOutputSchema'],
    ];
    for (const [path, schema] of expected) {
      const file = files.find((f) => f.path === path);
      expect(file, `${path} not found — was it renamed?`).toBeDefined();
      expect(file!.code, `${path} should declare outputSchema: ${schema}`).toMatch(
        new RegExp(`outputSchema:\\s*${schema}\\b`),
      );
    }
  });
});
