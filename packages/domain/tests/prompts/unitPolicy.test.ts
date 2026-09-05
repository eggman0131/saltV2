import { describe, it, expect } from 'vitest';
import {
  READER_UNIT_PRINCIPLE,
  SPOON_MEASURE_CAP_TBSP,
  clampSpoonMeasureDisplayText,
} from '../../src/prompts/index.js';

// Issue #934. What the constant SAYS is pinned here; that its two consumers
// interpolate rather than restate it is pinned in
// `apps/cloud-functions/tests/flows/unitPolicy.test.ts`, which may read source
// files — a test under `packages/domain` may not (the `node:fs` ban covers the
// whole package, tests included).

describe('READER_UNIT_PRINCIPLE', () => {
  it('puts the metric value first and the spoon in the bracket', () => {
    // The behaviour change #934 carries. The chef used to be told the reverse, and
    // the example is the load-bearing part of the sentence: a model reading this
    // copies the shape shown far more reliably than it obeys the rule stated.
    expect(READER_UNIT_PRINCIPLE).toContain('3 g salt (½ tsp)');
    expect(READER_UNIT_PRINCIPLE).toContain('15 ml oil (1 tbsp)');
    expect(READER_UNIT_PRINCIPLE).not.toContain('½ tsp salt (3 g)');
    expect(READER_UNIT_PRINCIPLE).toContain('The metric value always comes first');
  });

  it('states the 3 tbsp cap as a bound, both ways round', () => {
    // Stated only as a permission ("3 tbsp or less may be bracketed") it reads as
    // a licence with no upper edge, which is how it survived as a claim rather
    // than a rule. Both halves have to be present.
    expect(READER_UNIT_PRINCIPLE).toContain('3 tbsp or less');
    expect(READER_UNIT_PRINCIPLE).toContain('above 3 tbsp gets no bracket');
  });

  it('names what the metric value itself is', () => {
    // Not decoration: this is the half that survives from chefChat's four deleted
    // sentences, and dropping it would let the chef answer a dry weight in ml.
    expect(READER_UNIT_PRINCIPLE).toContain('grams for anything dry');
    expect(READER_UNIT_PRINCIPLE).toContain('millilitres for a liquid');
    expect(READER_UNIT_PRINCIPLE).toContain('a plain count of the thing as it is bought');
  });

  it('carries no bullet, label or newline of its own', () => {
    // It interpolates mid-paragraph into a conversational prompt and mid-bullet
    // into a markdown field list. A leading "- " or a newline breaks one of them.
    expect(READER_UNIT_PRINCIPLE.startsWith('- ')).toBe(false);
    expect(READER_UNIT_PRINCIPLE).not.toContain('\n');
  });

  it('states the bound using the shared constant, not a re-typed literal', () => {
    // #1196: five hand-typed "3"s is how the bound drifted from its own prompt
    // bullets undetected. The principle must read from `SPOON_MEASURE_CAP_TBSP`.
    expect(SPOON_MEASURE_CAP_TBSP).toBe(3);
    expect(READER_UNIT_PRINCIPLE).toContain(`${SPOON_MEASURE_CAP_TBSP} tbsp or less`);
    expect(READER_UNIT_PRINCIPLE).toContain(`above ${SPOON_MEASURE_CAP_TBSP} tbsp gets no bracket`);
  });
});

describe('clampSpoonMeasureDisplayText — the #1196 deterministic backstop', () => {
  it('nulls a spoon measure over the cap', () => {
    expect(clampSpoonMeasureDisplayText('4 tbsp')).toBeNull();
    expect(clampSpoonMeasureDisplayText('6 tbsp')).toBeNull();
    expect(clampSpoonMeasureDisplayText('10 tsp')).toBeNull(); // 10 tsp ≈ 3.33 tbsp
  });

  it('keeps a spoon measure at or under the cap, in every shape the prompt asks for', () => {
    expect(clampSpoonMeasureDisplayText('½ tsp')).toBe('½ tsp');
    expect(clampSpoonMeasureDisplayText('2 tbsp')).toBe('2 tbsp');
    expect(clampSpoonMeasureDisplayText('1½ tbsp')).toBe('1½ tbsp');
    expect(clampSpoonMeasureDisplayText('3 tbsp')).toBe('3 tbsp'); // exactly the cap: "or less"
    expect(clampSpoonMeasureDisplayText('9 tsp')).toBe('9 tsp'); // 9 tsp = 3 tbsp exactly
  });

  it('nulls the top of a range that crosses the cap, keeps one that does not', () => {
    expect(clampSpoonMeasureDisplayText('2-3 tbsp')).toBe('2-3 tbsp');
    expect(clampSpoonMeasureDisplayText('2–3 tbsp')).toBe('2–3 tbsp'); // en dash
    expect(clampSpoonMeasureDisplayText('3-4 tbsp')).toBeNull();
  });

  it('leaves every non-spoon displayText untouched, including null', () => {
    expect(clampSpoonMeasureDisplayText(null)).toBeNull();
    expect(clampSpoonMeasureDisplayText('about 105g')).toBe('about 105g');
    expect(clampSpoonMeasureDisplayText('2 limes')).toBe('2 limes');
    expect(clampSpoonMeasureDisplayText('1.5 tins')).toBe('1.5 tins');
    expect(clampSpoonMeasureDisplayText('about 2 medium')).toBe('about 2 medium');
  });
});
