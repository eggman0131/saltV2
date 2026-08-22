import { readFileSync } from 'node:fs';
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
const CALLABLE = fileURLToPath(new URL('../src/callables/getImagePrompt.ts', import.meta.url));

/** The prompt modules are full of prose ABOUT the wording; only real code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// One distinctive phrase from each locked constant — canon STYLE, the UK steer,
// the equipment/kitchen-tool anchors, and the recipe-hero anchors.
const LOCKED_PHRASES = [
  'Flat vector cartoon illustration',
  'as commonly sold in a UK supermarket',
  'Absolutely no lettering anywhere in the picture',
  'the FOOD is always the star of the shot',
];

const BUILDERS = [
  'buildIconPrompt',
  'buildKitchenToolIconPrompt',
  'buildEquipmentIconPrompt',
  'buildRecipePrompt',
];

describe('getImagePrompt is not a second copy of the prompts', () => {
  const code = stripComments(readFileSync(CALLABLE, 'utf8'));

  it.each(LOCKED_PHRASES)('does not restate the locked wording: %s', (phrase) => {
    expect(code).not.toContain(phrase);
  });

  it.each(BUILDERS)('calls the real builder: %s', (builder) => {
    expect(code).toContain(builder);
  });

  it('covers every family the wire schema declares', async () => {
    // A family added to the schema with no arm here would fail to compile, but a
    // family added here and never offered to a caller would not — so the two
    // lists are pinned together rather than assumed.
    const { IMAGE_PROMPT_FAMILIES } = await import('@salt/domain/schemas');
    for (const family of IMAGE_PROMPT_FAMILIES) {
      expect(code).toContain(`case '${family}'`);
    }
  });
});
