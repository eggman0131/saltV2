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

describe('recipeFieldRules — the wording policy is the ONLY divergence', () => {
  it('differs from the other rendering in exactly the one rawText line', () => {
    // The invariant this module exists to hold. Before #785 the same field list
    // lived twice — once in recipeExtractionRules.ts and once hand-rolled inside
    // LIBRARIAN_SYSTEM — and had drifted in both directions. Anything that differs
    // here beyond the wording policy is that drift coming back, so this test
    // deliberately compares the two renderings LINE BY LINE rather than checking
    // for a few phrases.
    const onlyIn = (a: string, b: string) =>
      a.split('\n').filter((line) => !b.split('\n').includes(line));

    const preserveOnly = onlyIn(PRESERVE, METRICATE);
    const metricateOnly = onlyIn(METRICATE, PRESERVE);

    // One line each, and it is the ingredient `rawText` clause both times. The
    // conversion bullet that used to make this 1-vs-2 is now unconditional — the
    // UNITS no longer fork, only how freely the line may be rewritten.
    expect(preserveOnly).toHaveLength(1);
    expect(metricateOnly).toHaveLength(1);
    expect(preserveOnly[0]).toContain('preserve the original wording');
    expect(metricateOnly[0]).toContain('the ingredient line rewritten in British spelling/terms');
  });

  it("rewrites a document source's line", () => {
    expect(METRICATE).toContain('the ingredient line rewritten in British spelling/terms');
    expect(METRICATE).not.toContain('preserve the original wording');
  });

  it("preserves a conversation source's wording, and says what overrides that", () => {
    // Without the precedence sentence, "preserve the original wording" reads as a
    // licence to keep "1 cup heavy cream" and "salt and freshly ground black
    // pepper" — the measure and ingredient rules are unconditional and have to be
    // seen to win.
    expect(PRESERVE).toContain('preserve the original wording and any tsp/tbsp measures');
    expect(PRESERVE).toContain('EXCEPT where the conversion rules above take precedence');
    expect(PRESERVE).toContain('never a cup, pint or ounce, however the chef phrased it');
    expect(PRESERVE).toContain('These override "preserve the original wording"');
  });
});

describe('recipeFieldRules — the measure vocabulary is UNCONDITIONAL', () => {
  // The units used to fork with the source kind, and that fork is what made
  // imports lose their spoon measures: 'metricate' ordered tablespoons and
  // teaspoons converted, so by the time `assembleRecipeDraft` handed the rawText
  // to `parseRecipeIngredients` there was no spoon left to lift into displayText
  // — parse only ever sees this rawText, never the original source line. Both
  // renderings must now carry the same two bullets.
  it('asks every path for grams, millilitres or a count', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain('Metric or count values only');
      expect(rules).toContain('NEVER cups, sticks, pints, quarts, fluid ounces, ounces or pounds');
    }
  });

  it('tells every path to leave tsp/tbsp alone for the parse stage', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain('tsp and tbsp are the ONE exception');
      expect(rules).toContain('leave a spoon measure EXACTLY as the source wrote it');
      expect(rules).toContain('so converting it here is what DESTROYS it');
    }
  });

  it('never tells any path to convert tablespoons or teaspoons', () => {
    // The exact regression: this instruction sat in the 'metricate' bullet and
    // silently deleted every imported recipe's spoon measures.
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).not.toContain('tablespoons and teaspoons');
    }
  });
});

describe('recipeFieldRules — the retired three numbers are asked for nowhere (#1213)', () => {
  // The phase strip is the whole of what the app asks about timing. The prompt no
  // longer mentions prepTimeMinutes / cookTimeMinutes / totalTimeMinutes at all —
  // asking for a number nobody stores pays for a discarded answer and keeps the
  // split definition #1122 exists to end alive in the one text every authoring
  // path shares.
  it('never names a field the app no longer stores', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).not.toContain('prepTimeMinutes');
      expect(rules).not.toContain('cookTimeMinutes');
      expect(rules).not.toContain('totalTimeMinutes');
    }
  });

  // The clause that reconciled the three against each other. It became
  // definitional the moment elapsed time was a sum of the parts, which is why
  // `reconcileRecipeTimes` went with it rather than being kept "for the schema".
  it('drops the total >= prep + cook arithmetic rule with the fields it governed', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).not.toContain('MUST reconcile');
      expect(rules).not.toContain('>=');
    }
  });
});

describe('recipeFieldRules — the phase strip is defined on every path (#1122)', () => {
  // The strip is what recipe timing BECOMES, so it has to be defined in the ONE
  // shared text every authoring path is given — not appended to the estimator's
  // own flow-local heuristics, which the librarian and the two extractors never
  // see. Half a library drawn to one definition of "hands-on" and half to another
  // is the #785 twin, and these assertions are what stop it.
  it('asks every path for an ordered list of named blocks, capped at six', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain("phases: the recipe's timing as an ORDERED list of 3–6 named blocks");
      expect(rules).toContain('never more than six');
    }
  });

  it('asks for exactly two numbers per phase, and forbids a third', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain('handsOnMinutes');
      expect(rules).toContain('handsOffMinutes');
      expect(rules).toContain('do NOT return a total for a phase');
    }
  });

  // The 12-minute pan of water that opened the issue: the minutes nobody timed
  // have to land somewhere, and "somewhere" is a phase's hands-off time.
  it('demands the untimed waits be accounted for, and folds overlap into one phase', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain('pan of water to the boil');
      expect(rules).toContain('Work that OVERLAPS goes in ONE phase, never two');
      expect(rules).toContain('Phases are NOT steps');
    }
  });

  it('asks for the one-line summary', () => {
    for (const rules of [PRESERVE, METRICATE]) {
      expect(rules).toContain('timingSummary: ONE short plain sentence');
    }
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
