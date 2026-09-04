/**
 * Source guard for the CLAUDE.md hard rule "Wrap every AI call in withAiTimeout".
 *
 * A bare Genkit call has no built-in deadline, so a hung model holds the whole
 * function for its full quota (~60–120s) instead of failing fast. This test
 * reads the Cloud Functions source off disk and fails when a file calls the
 * model without a guard in it.
 *
 * ── Why this file was rewritten (issue #915) ─────────────────────────────────
 *
 * The previous version was the guard that should have caught #915 and did not,
 * for three reasons, all fixed here:
 *
 *  1. It scanned `src/flows/` only, and FLAT. `ai.generate` / `ai.embed` in
 *     `triggers/`, `callables/`, `adapters/` and `ai/` was invisible to it. The
 *     scan surface is now DERIVED from the tree — every `.ts` under `src`,
 *     recursively — because a hand-listed set of directories is the same defect
 *     one level up.
 *  2. It did not know about `ai.generateStream`. chefChat's drain loop ran with
 *     no deadline at all while the file passed the guard, because a
 *     `withAiTimeout` further down (around the already-drained aggregate
 *     response) satisfied it. A streaming call now demands the STREAM guard
 *     specifically: `withAiTimeout` around a stream is precisely the bug.
 *  3. It carried a WRAPPED_BY_CALLER allowlist — four flows excused on the
 *     promise that every caller wrapped the invocation. Two of them
 *     (`embedText`, `arbitrateCanon`) were also exported as their own
 *     callables, which no caller wrapped, so the promise was false. The
 *     allowlist is gone: the deadline belongs next to the model call, in the
 *     file that makes it, and there is no way to opt out.
 *
 * This is a genuine source scan — it reads bytes from the filesystem and never
 * imports the modules it checks. The 18 unit-test files that stub
 * `withAiTimeout` out entirely, and the CF convention of replacing `defineFlow`
 * with the identity function, cannot make it vacuously green.
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

// Strip // line comments and /* */ block comments so a mention of the model call
// or of the wrapper in prose never counts toward the guard either way.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const GENERATE_OR_EMBED = /\bai\.(generate|embed)\s*\(/;
const GENERATE_STREAM = /\bai\.generateStream\s*\(/;
const HAS_WRAP = /\bwithAiTimeout\s*\(/;
const HAS_STREAM_WRAP = /\bwithAiStreamTimeout\s*\(/;

interface Scanned {
  readonly path: string;
  readonly code: string;
}

const files: Scanned[] = walk(srcDir).map((path) => ({
  path: relative(srcDir, path).split(sep).join('/'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

const callsModel = files.filter(
  (f) => GENERATE_OR_EMBED.test(f.code) || GENERATE_STREAM.test(f.code),
);

describe('cloud-functions: every AI call is guarded by a timeout', () => {
  it('walks the whole src tree, not just flows (the #915 blind spot)', () => {
    // Two independent floors, so neither a collapsed walk nor a regex that
    // stopped matching can leave this suite quietly asserting nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(callsModel.length).toBeGreaterThan(10);
    // The widening itself: model calls live outside src/flows, and the previous
    // guard could not see them.
    expect(
      callsModel.filter((f) => !f.path.startsWith('flows/')).map((f) => f.path).length,
      'no AI call found outside src/flows — the scan has narrowed back to the flows directory',
    ).toBeGreaterThan(0);
    // And the streaming shape is live, so the stream branch below is reachable.
    expect(
      callsModel.filter((f) => GENERATE_STREAM.test(f.code)).length,
      'no ai.generateStream found — the streaming half of the guard is asserting nothing',
    ).toBeGreaterThan(0);
  });

  for (const file of callsModel) {
    it(`${file.path} guards its AI call`, () => {
      if (GENERATE_OR_EMBED.test(file.code)) {
        expect(
          HAS_WRAP.test(file.code),
          `${file.path} calls ai.generate/ai.embed but has no withAiTimeout guard. ` +
            `Wrap the call in withAiTimeout (see identifyRecipeKit.ts). The deadline ` +
            `belongs in the file that makes the call — a caller applying one from ` +
            `outside only covers the callers that remember, and a flow exported as ` +
            `its own callable has no caller to remember.`,
        ).toBe(true);
      }
      if (GENERATE_STREAM.test(file.code)) {
        expect(
          HAS_STREAM_WRAP.test(file.code),
          `${file.path} calls ai.generateStream but has no withAiStreamTimeout guard. ` +
            `withAiTimeout cannot guard a stream: wrapping the aggregated response ` +
            `puts the deadline AFTER the drain loop, so a model that goes quiet ` +
            `mid-stream never reaches it (issue #915). Iterate the stream through ` +
            `withAiStreamTimeout instead (see chefChat.ts).`,
        ).toBe(true);
      }
    });
  }
});
