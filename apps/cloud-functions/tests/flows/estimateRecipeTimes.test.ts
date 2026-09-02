import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));

vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: { model: (name: string) => name },
}));

// Stub withAiTimeout to call op() directly — timeout/retry logic is tested
// elsewhere. Keep everything else the module exports (the shared budget constant,
// the stream guard): a factory listing only `withAiTimeout` goes stale the moment
// the module grows.
vi.mock('../../src/adapters/withAiTimeout.js', async (importActual) => ({
  ...(await importActual<object>()),
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));

// resolveModel reads Firestore in production; pin it in the unit test.
vi.mock('../../src/ai/resolveModel.js', () => ({
  resolveModel: vi.fn().mockResolvedValue('gemini-flash-latest'),
}));

const { estimateRecipeTimesFlow, reconcileEstimatedTimes } =
  await import('../../src/flows/estimateRecipeTimes.js');
const { TIME_RULES } = await import('../../src/flows/recipeFieldRules.js');

beforeEach(() => {
  mockGenerate.mockReset();
});

const input = {
  title: 'Paneer Makhanwala',
  description: null,
  servings: 4,
  ingredients: ['400g paneer, cubed', '2 large onions, finely sliced'],
  steps: [
    { text: 'Fry the onions until soft.', timerMinutes: 15 },
    { text: 'Simmer the sauce.', timerMinutes: 20 },
  ],
};

function respond(output: unknown) {
  mockGenerate.mockResolvedValue({ output });
}

describe('reconcileEstimatedTimes', () => {
  // The real Paneer Makhanwala shape from the issue: a model-stated total below
  // its own parts, which is the arithmetically impossible document #952 exists to
  // stop being written.
  it('raises a stated total that is below prep + cook', () => {
    expect(
      reconcileEstimatedTimes({ prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 35 }),
    ).toEqual({
      prepTimeMinutes: 10,
      cookTimeMinutes: 35,
      totalTimeMinutes: 45,
      phases: [],
      timingSummary: null,
    });
  });

  it('leaves a total ABOVE prep + cook alone — the excess is an unattended wait', () => {
    // Overnight No Knead Focaccia: 30 + 12 with a 762-minute prove between them.
    // The contract is `>=`, not `===`; a proving time is not prep and not cook.
    expect(
      reconcileEstimatedTimes({ prepTimeMinutes: 30, cookTimeMinutes: 12, totalTimeMinutes: 762 }),
    ).toEqual({
      prepTimeMinutes: 30,
      cookTimeMinutes: 12,
      totalTimeMinutes: 762,
      phases: [],
      timingSummary: null,
    });
  });

  it('derives a missing total from the two parts', () => {
    expect(
      reconcileEstimatedTimes({ prepTimeMinutes: 20, cookTimeMinutes: 25, totalTimeMinutes: null }),
    ).toEqual({
      prepTimeMinutes: 20,
      cookTimeMinutes: 25,
      totalTimeMinutes: 45,
      phases: [],
      timingSummary: null,
    });
  });

  it('cannot derive a total when a part is missing, and does not invent one', () => {
    expect(
      reconcileEstimatedTimes({
        prepTimeMinutes: 20,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
      }),
    ).toEqual({
      prepTimeMinutes: 20,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      phases: [],
      timingSummary: null,
    });
  });

  // The #739 asymmetry, and the ORDER that makes it work: reconcile from the raw
  // values, fold zeros only afterwards. Folding first would read "no cooking" as
  // "not stated" and throw the total away.
  it('folds a 0 part to null but still counts it in the total first', () => {
    expect(
      reconcileEstimatedTimes({ prepTimeMinutes: 15, cookTimeMinutes: 0, totalTimeMinutes: null }),
    ).toEqual({
      prepTimeMinutes: 15,
      cookTimeMinutes: null,
      totalTimeMinutes: 15,
      phases: [],
      timingSummary: null,
    });
  });

  it('folds a total of 0 to null — a recipe that takes no time at all is nonsense', () => {
    expect(
      reconcileEstimatedTimes({ prepTimeMinutes: 0, cookTimeMinutes: 0, totalTimeMinutes: null }),
    ).toEqual({
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      phases: [],
      timingSummary: null,
    });
  });
});

describe('estimateRecipeTimesFlow', () => {
  it('asks against the SHARED field DEFINITIONS, not a copy of them', async () => {
    // The load-bearing assertion of this file — precise about which half is
    // shared. If the backfill ever measures recipes against its own
    // hand-written field definitions, the library goes back to being split
    // between two of them — which is the whole of issue #952. The estimation
    // HEURISTICS below TIME_RULES are a separate, flow-local half not covered
    // by this assertion — see the "FIELD DEFINITIONS... ESTIMATION HEURISTICS"
    // header comment in estimateRecipeTimes.ts.
    respond({ prepTimeMinutes: 20, cookTimeMinutes: 35, totalTimeMinutes: 55 });
    await estimateRecipeTimesFlow(input);
    const { system } = mockGenerate.mock.calls[0]![0] as { system: string };
    expect(system).toContain(TIME_RULES);
  });

  it('sends the ingredient lines and the step timers as the evidence', async () => {
    respond({ prepTimeMinutes: 20, cookTimeMinutes: 35, totalTimeMinutes: 55 });
    await estimateRecipeTimesFlow(input);
    const { prompt } = mockGenerate.mock.calls[0]![0] as { prompt: string };
    expect(prompt).toContain('2 large onions, finely sliced');
    expect(prompt).toContain('[timer: 20 min]');
    expect(prompt).toContain('Servings: 4');
  });

  it('never shows the model the times it is replacing', async () => {
    // The stored triple is wrong in a known direction (low), so quoting it back is
    // an anchor towards the number being corrected. The input schema has no field
    // for it; this pins that the prompt has no back door either.
    respond({ prepTimeMinutes: 20, cookTimeMinutes: 35, totalTimeMinutes: 55 });
    await estimateRecipeTimesFlow(input);
    const { prompt } = mockGenerate.mock.calls[0]![0] as { prompt: string };
    expect(prompt).not.toMatch(/current|stored|existing/i);
  });

  it('reconciles the model answer before it leaves the flow', async () => {
    respond({ prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 35 });
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      prepTimeMinutes: 10,
      cookTimeMinutes: 35,
      totalTimeMinutes: 45,
      phases: [],
      timingSummary: null,
    });
  });

  // Issue #1122. The phases travel in the SAME call as the three numbers and are
  // handed back untouched — no reconciliation, no zero-fold — because their
  // arithmetic is a sum computed where they are read.
  it('returns the phase strip and its summary untouched', async () => {
    respond({
      prepTimeMinutes: 20,
      cookTimeMinutes: 35,
      totalTimeMinutes: 55,
      phases: [
        { label: 'Prep', handsOnMinutes: 20, handsOffMinutes: 0 },
        { label: 'Cook', handsOnMinutes: 5, handsOffMinutes: 30 },
      ],
      timingSummary: 'About 25 minutes of you, over just under an hour.',
    });
    await expect(estimateRecipeTimesFlow(input)).resolves.toMatchObject({
      phases: [
        { label: 'Prep', handsOnMinutes: 20, handsOffMinutes: 0 },
        { label: 'Cook', handsOnMinutes: 5, handsOffMinutes: 30 },
      ],
      timingSummary: 'About 25 minutes of you, over just under an hour.',
    });
  });

  // A phase of 0 hands-on is an unattended wait — a real answer, and NOT the
  // model glitch the three numbers' zero-fold exists to catch. This goes red if
  // anyone extends `reconcileEstimatedTimes`'s fold over the strip.
  it('keeps a phase with no hands-on time rather than folding it away', async () => {
    respond({
      prepTimeMinutes: 5,
      cookTimeMinutes: 0,
      totalTimeMinutes: 725,
      phases: [
        { label: 'Mix', handsOnMinutes: 5, handsOffMinutes: 0 },
        { label: 'Prove overnight', handsOnMinutes: 0, handsOffMinutes: 720 },
      ],
      timingSummary: null,
    });
    const result = await estimateRecipeTimesFlow(input);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[1]).toEqual({
      label: 'Prove overnight',
      handsOnMinutes: 0,
      handsOffMinutes: 720,
    });
  });

  // The cap the strip is drawn against (`MAX_RECIPE_PHASES`). A seventh block
  // fails the trust-boundary parse, which the trigger reads as "not estimated
  // yet" and the backfill script retries — the same bargain a fractional minute
  // count makes below.
  it('rejects a strip longer than six blocks', async () => {
    respond({
      prepTimeMinutes: 20,
      cookTimeMinutes: 35,
      totalTimeMinutes: 55,
      phases: Array.from({ length: 7 }, (_, i) => ({
        label: `Phase ${i + 1}`,
        handsOnMinutes: 5,
        handsOffMinutes: 0,
      })),
      timingSummary: null,
    });
    await expect(estimateRecipeTimesFlow(input)).rejects.toThrow(/invalid output/);
  });

  it('throws on an output that fails the trust-boundary parse', async () => {
    // A fractional minute count, which the schema rejects. The trigger catches
    // this, leaves `timesEstimatedAt` unstamped, and the script picks the recipe
    // up on its next run.
    respond({ prepTimeMinutes: 12.5, cookTimeMinutes: 35, totalTimeMinutes: 55 });
    await expect(estimateRecipeTimesFlow(input)).rejects.toThrow(/invalid output/);
  });
});
