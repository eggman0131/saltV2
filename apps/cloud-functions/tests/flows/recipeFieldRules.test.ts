import { describe, it, expect } from 'vitest';
import { recipeFieldRules } from '../../src/flows/recipeFieldRules.js';
import { CATEGORY_TAG_RULES } from '../../src/flows/categoryTags.js';
import { INGREDIENT_SUBSTITUTION_RULES } from '../../src/flows/ingredientConversions.js';
import { STEP_RULES, FIRST_USE_ORDINAL_RULE } from '../../src/flows/stepRules.js';

// Issue #785. This is a prompt SECTION PAIR, not a whole prompt: the two markdown
// sections it renders are interpolated into the middle of three different system
// prompts (authorRecipe's LIBRARIAN_SYSTEM, extractRecipeFromUrl's two, and
// extractRecipeFromPhoto's). Getting the heading levels or the bullet shape wrong
// fails no type check and no lint — it silently corrupts every authoring prompt at
// once, which is what the shape assertions below exist to catch. Same reasoning as
// stepRules.test.ts, one layer out.
//
// The per-path tests that pin each of the three flows to this module live beside
// those flows (authorRecipe.test.ts, extractRecipeFromUrl.rules.test.ts,
// extractRecipeFromPhoto.test.ts) — a hand-rolled twin has to fail a test there,
// not merely disagree with this file in spirit.

const PRESERVE = recipeFieldRules({ measures: 'preserve' });
const METRICATE = recipeFieldRules({ measures: 'metricate' });

describe('recipeFieldRules — shape', () => {
  it('opens with the conversion section and follows with the field list', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules.startsWith('## Conversion rules (apply to EVERYTHING)')).toBe(true);
      expect(rules).toContain('\n\n## Fields\n- title:');
    }
  });

  it('interpolates every shared rule module, in both renderings', () => {
    // The whole point of the module: one edit to any of these reaches all three
    // authoring paths. A rendering that dropped one would still look like a valid
    // prompt.
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain(CATEGORY_TAG_RULES);
      expect(rules).toContain(INGREDIENT_SUBSTITUTION_RULES);
      expect(rules).toContain(STEP_RULES);
      expect(rules).toContain(FIRST_USE_ORDINAL_RULE);
    }
  });
});

describe('recipeFieldRules — the measure policy is the ONLY divergence', () => {
  it('differs from the other rendering in exactly the two measure lines', () => {
    // The invariant this module exists to hold. Before #785 the same field list
    // lived twice — once in recipeExtractionRules.ts and once hand-rolled inside
    // LIBRARIAN_SYSTEM — and had drifted in both directions. Anything that differs
    // here beyond the measure policy is that drift coming back, so this test
    // deliberately compares the two renderings LINE BY LINE rather than checking
    // for a few phrases.
    const onlyIn = (a: string, b: string) =>
      a.split('\n').filter((line) => !b.split('\n').includes(line));

    const preserveOnly = onlyIn(PRESERVE, METRICATE);
    const metricateOnly = onlyIn(METRICATE, PRESERVE);

    // One line each: the ingredient `rawText` clause. Plus, on the metricate side
    // only, the bullet that orders the conversion in the first place.
    expect(preserveOnly).toHaveLength(1);
    expect(metricateOnly).toHaveLength(2);
    expect(preserveOnly[0]).toContain('preserve the original wording');
    expect(metricateOnly.join('\n')).toContain('already converted to metric');
    expect(metricateOnly.join('\n')).toContain('Metric only: convert all quantities to metric');
  });

  it("metricates a document source's quantities", () => {
    expect(METRICATE).toContain('Metric only: convert all quantities to metric');
    expect(METRICATE).toContain('Convert cups, sticks, ounces, pounds');
    expect(METRICATE).not.toContain('preserve the original wording');
  });

  it("preserves a conversation source's measures, and says what overrides that", () => {
    // Without the precedence sentence, "preserve the original wording" reads as a
    // licence to keep "heavy cream" and "salt and freshly ground black pepper" —
    // the ingredient rules are unconditional and have to be seen to win.
    expect(PRESERVE).toContain('preserve the original wording and any tsp/tbsp/cup measures');
    expect(PRESERVE).toContain('EXCEPT where the conversion rules above take precedence');
    expect(PRESERVE).toContain('These override "preserve the original wording"');
    expect(PRESERVE).not.toContain('Metric only');
  });
});

describe('recipeFieldRules — unconditional rules', () => {
  it('converts temperatures, names and spelling whichever the source', () => {
    // None of these is a measure the chef chose, so preserving their wording
    // preserves nothing worth keeping — an app that writes recipes in British
    // English writes them in British English from a chat as much as from a URL.
    // Before #785 the librarian had neither the °C bullet nor the spelling one.
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain('Temperatures in °C only — never Fahrenheit');
      expect(rules).toContain('Use British spelling everywhere');
      expect(rules).toContain('British ingredient names throughout');
    }
  });

  it('applies both ingredient-hygiene rules on every path', () => {
    // "Salt and freshly ground black pepper" off a website is exactly as
    // unmatchable as one from a conversation. Both rules ride in
    // INGREDIENT_SUBSTITUTION_RULES, which every rendering interpolates — the
    // librarian used to restate them inline as well, and that copy is what #785
    // deleted.
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain('Commit to a single ingredient');
      expect(rules).toContain('One ingredient per line');
    }
  });
});
