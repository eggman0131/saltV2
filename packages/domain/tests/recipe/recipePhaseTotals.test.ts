import { describe, it, expect } from 'vitest';
import { recipePhaseTotals, phaseElapsedMinutes } from '../../src/index.js';
import type { RecipePhase } from '../../src/index.js';

const phase = (label: string, handsOnMinutes: number, handsOffMinutes: number): RecipePhase => ({
  label,
  handsOnMinutes,
  handsOffMinutes,
});

// A loaf: the spec's own worked example, and the case that motivated the issue —
// most of its wall clock is time the cook is not in the kitchen.
const BREAD: RecipePhase[] = [
  phase('Mix & knead', 15, 0),
  phase('First rise', 0, 90),
  phase('Shape', 5, 0),
  phase('Second rise', 0, 45),
  phase('Bake', 2, 35),
  phase('Cool', 0, 30),
];

describe('phaseElapsedMinutes', () => {
  it('is the two stored numbers added, and nothing else', () => {
    expect(phaseElapsedMinutes(phase('Bake', 2, 35))).toBe(37);
  });
});

describe('recipePhaseTotals', () => {
  it('sums hands-on, hands-off and elapsed across the strip', () => {
    expect(recipePhaseTotals(BREAD)).toEqual({
      handsOnMinutes: 22,
      handsOffMinutes: 200,
      elapsedMinutes: 222,
      hasPhases: true,
    });
  });

  it('keeps elapsed equal to hands-on + hands-off by construction', () => {
    const totals = recipePhaseTotals(BREAD);
    expect(totals.elapsedMinutes).toBe(totals.handsOnMinutes + totals.handsOffMinutes);
  });

  it('reports no phases for an absent list — a document written before #1122', () => {
    expect(recipePhaseTotals(undefined)).toEqual({
      handsOnMinutes: 0,
      handsOffMinutes: 0,
      elapsedMinutes: 0,
      hasPhases: false,
    });
  });

  it('reports no phases for an empty list', () => {
    expect(recipePhaseTotals([]).hasPhases).toBe(false);
  });

  // The distinction the `hasPhases` doc comment claims: a stated timing of zero is
  // still a stated timing, and must not read as "never estimated".
  it('reports phases present when every phase sums to zero', () => {
    expect(recipePhaseTotals([phase('Assemble', 0, 0)])).toEqual({
      handsOnMinutes: 0,
      handsOffMinutes: 0,
      elapsedMinutes: 0,
      hasPhases: true,
    });
  });

  // The read boundary is deliberately permissive (`z.number()`, no refine), so a
  // stored document can carry any of these. One bad phase must not poison the
  // whole recipe's timing.
  it('counts a NaN, an Infinity or a negative as zero rather than poisoning the sum', () => {
    const totals = recipePhaseTotals([
      phase('Prep', 10, 0),
      phase('Bad', Number.NaN, Number.POSITIVE_INFINITY),
      phase('Worse', -30, 0),
      phase('Cook', 5, 20),
    ]);
    expect(totals).toEqual({
      handsOnMinutes: 15,
      handsOffMinutes: 20,
      elapsedMinutes: 35,
      hasPhases: true,
    });
  });

  it('does not mutate or reorder the phases it is given', () => {
    const input = [...BREAD];
    recipePhaseTotals(input);
    expect(input).toEqual(BREAD);
  });
});
