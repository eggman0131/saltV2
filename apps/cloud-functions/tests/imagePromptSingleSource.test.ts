import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The one invariant the prompt window rests on (issue #892): it CALLS the prompt
// builders, it never restates them.
//
// This is a source scan rather than an output assertion because the failure mode
// is somebody later finding it easier to paste a sentence in than to thread an
// argument through — and that failure is SILENT. Two copies of the same wording
// drift apart without a red test anywhere: the picture keeps changing while the
// window swears it has not. docs/canon-icons.md warns about exactly this, and
// flows/placeholderVocabulary.ts exists because it already happened once.
//
// ─── The wording is READ, not remembered (issue #919) ────────────────────────
//
// This test used to carry four English sentences copied out of the prompt
// constants, which made it a THIRD copy of the very wording it exists to keep to
// one copy — and a copy with a specific, quiet failure: `not.toContain` on a
// phrase nobody says any more passes for free. Reword `STYLE` and all four
// assertions go green over a file that could then restate the new wording in
// full. A guard that gets safer the more the thing it guards changes is not a
// guard.
//
// So the phrases are now READ OUT of the prompt modules on every run, and the
// module set is read out of the tree — every file under `src/flows/` exporting a
// `build*Prompt`. A new prompt family is protected the day it is written, and
// re-wording an old one re-arms the guard against the new words rather than
// disarming it against the old ones.
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FLOWS = join(SRC, 'flows');
const CALLABLE = join(SRC, 'callables/getImagePrompt.ts');

/** The prompt modules are full of prose ABOUT the wording; only real code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Every flow module that builds a prompt — the tree decides, not a list here. */
function promptModules(): string[] {
  return readdirSync(FLOWS)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(FLOWS, name))
    .filter((path) => /export function build\w*Prompt/.test(readFileSync(path, 'utf8')));
}

/**
 * The static wording inside a module's string and template literals, as
 * sentences. Interpolations split a template literal — what surrounds a
 * `${…}` is still fixed wording and still must not be restated.
 */
function lockedSentences(source: string): string[] {
  const code = stripComments(source);
  const chunks: string[] = [];
  for (const [, single] of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) chunks.push(single as string);
  for (const [, template] of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    chunks.push(...(template as string).split(/\$\{[^}]*\}/));
  }
  return (
    chunks
      .flatMap((chunk) => chunk.split(/(?<=[.!?])\s+/))
      .map((sentence) => sentence.trim())
      // Short fragments are log keys, field names and punctuation, not house style.
      // 30 characters is where the prompts' own shortest real clause sits — `STYLE`
      // opens on "Flat vector cartoon illustration." — and it is still long enough
      // that nothing incidental in the callable collides with it.
      .filter((sentence) => sentence.length >= 30 && /\s/.test(sentence))
  );
}

const LOCKED = [
  ...new Set(promptModules().flatMap((path) => lockedSentences(readFileSync(path, 'utf8')))),
];
const CODE = stripComments(readFileSync(CALLABLE, 'utf8'));

describe('getImagePrompt is not a second copy of the prompts', () => {
  it('reads a real body of locked wording out of the prompt modules', () => {
    // Anti-vacuity, and it is the whole point: an extractor that quietly stopped
    // matching would turn the scan below into a loop over nothing. The four
    // phrases the old hand-list named must be among what it finds — not as a
    // list to maintain, but as proof the reader still reads.
    expect(promptModules().length).toBeGreaterThanOrEqual(4);
    expect(LOCKED.length).toBeGreaterThan(30);
    for (const phrase of [
      'Flat vector cartoon illustration',
      'as commonly sold in a UK supermarket',
      'Absolutely no lettering anywhere in the picture',
      'the FOOD is always the star of the shot',
    ]) {
      expect(
        LOCKED.some((sentence) => sentence.includes(phrase)),
        `the extractor no longer sees "${phrase}" — it has stopped reading the prompts`,
      ).toBe(true);
    }
  });

  it('restates none of the locked wording', () => {
    const restated = LOCKED.filter((sentence) => CODE.includes(sentence));
    expect(
      restated,
      `getImagePrompt.ts spells out wording that belongs to a prompt builder — ` +
        `call the builder instead: ${restated.join(' | ')}`,
    ).toEqual([]);
  });

  it.each([
    'buildIconPrompt',
    'buildKitchenToolIconPrompt',
    'buildEquipmentIconPrompt',
    'buildRecipePrompt',
  ])('calls the real builder: %s', (builder) => {
    expect(CODE).toContain(builder);
  });

  it('imports no builder it does not call', () => {
    // The other half of "it calls the builders": an import with no call site is
    // an arm that went its own way and left the import behind.
    const imported = [...CODE.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/flows\/[^']*'/g)]
      .flatMap(([, clause]) => (clause as string).split(','))
      .map((name) => name.trim())
      .filter((name) => /^build\w*Prompt$/.test(name));
    expect(imported.length).toBeGreaterThanOrEqual(4);
    for (const builder of imported) {
      expect(
        new RegExp(`${builder}\\s*\\(`).test(CODE),
        `${builder} is imported, never called`,
      ).toBe(true);
    }
  });

  it('covers every family the wire schema declares', async () => {
    // A family added to the schema with no arm here would fail to compile, but a
    // family added here and never offered to a caller would not — so the two
    // lists are pinned together rather than assumed.
    const { IMAGE_PROMPT_FAMILIES } = await import('@salt/domain/schemas');
    for (const family of IMAGE_PROMPT_FAMILIES) {
      expect(CODE).toContain(`case '${family}'`);
    }
  });
});
