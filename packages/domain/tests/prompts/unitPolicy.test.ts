import { describe, it, expect } from 'vitest';
import { READER_UNIT_PRINCIPLE } from '../../src/prompts/index.js';

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
});
