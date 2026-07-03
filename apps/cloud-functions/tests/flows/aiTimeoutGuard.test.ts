import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Grep guard for the CLAUDE.md hard rule "Wrap every AI call in withAiTimeout".
// A bare Genkit `ai.generate` / `ai.embed` has no built-in deadline, so a hung
// model holds the whole function for its full quota (~60s) instead of failing
// fast. This test walks every flow file and fails if one calls the model
// without a withAiTimeout guard — the exact regression that shipped for
// identifyEquipment / populateEquipmentEntry (issue #409).
const flowsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/flows');

// Flows whose AI call is deliberately wrapped by a CALLER rather than in-file:
// an adapter/trigger applies withAiTimeout around the whole flow invocation.
// Do NOT add to this list without confirming EVERY caller wraps the invocation
// in withAiTimeout — otherwise wrap the call in-file instead.
const WRAPPED_BY_CALLER = new Set([
  'parseEntry.ts', // serverEntryParse.ts → withAiTimeout('parseEntry', …)
  'arbitrateCanon.ts', // serverArbitration.ts → withAiTimeout('arbitrateCanon', …)
  'embedText.ts', // serverEmbedding.ts / onCanonItemWritten.ts → withAiTimeout('embedText', …)
]);

// Strip // line comments and /* */ block comments so a mention of the model
// call or the wrapper in prose never counts toward the guard either way.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const AI_CALL = /\bai\.(generate|embed)\s*\(/;
const HAS_WRAP = /\bwithAiTimeout\s*\(/;

describe('flows: every ai.generate/ai.embed is guarded by withAiTimeout', () => {
  const files = readdirSync(flowsDir).filter((f) => f.endsWith('.ts'));

  const aiFlows = files.filter((f) =>
    AI_CALL.test(stripComments(readFileSync(join(flowsDir, f), 'utf8'))),
  );

  it('finds flow files that call the model (sanity check the guard is live)', () => {
    expect(aiFlows.length).toBeGreaterThan(0);
  });

  for (const file of aiFlows) {
    it(`${file} wraps its AI call in withAiTimeout`, () => {
      const code = stripComments(readFileSync(join(flowsDir, file), 'utf8'));
      const guarded = HAS_WRAP.test(code) || WRAPPED_BY_CALLER.has(file);
      expect(
        guarded,
        `${file} calls ai.generate/ai.embed but has no withAiTimeout guard. ` +
          `Wrap the call in withAiTimeout (see categoriseRecipe.ts), or — only if a ` +
          `caller applies the timeout around every invocation — add it to ` +
          `WRAPPED_BY_CALLER with a note.`,
      ).toBe(true);
    });
  }
});
