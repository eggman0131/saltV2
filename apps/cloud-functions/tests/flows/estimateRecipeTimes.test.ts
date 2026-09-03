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
  // Issue #1213 emptied this function out. It used to impose
  // `total >= prep + cook` on the model's three numbers and fold their zeros;
  // both went with the fields, because elapsed time is now a sum of a phase's two
  // numbers by construction. What is left is the absent → empty conversion, and
  // this is the one place on the re-estimate path where it happens.
  it('turns an omitted strip into an empty one, and an omitted sentence into null', () => {
    expect(reconcileEstimatedTimes({})).toEqual({ phases: [], timingSummary: null });
  });

  it('passes a strip through untouched — no reconciliation, no zero-fold', () => {
    const phases = [
      { label: 'Mix', handsOnMinutes: 5, handsOffMinutes: 0 },
      { label: 'Prove overnight', handsOnMinutes: 0, handsOffMinutes: 720 },
    ];
    expect(reconcileEstimatedTimes({ phases, timingSummary: 'Mostly waiting.' })).toEqual({
      phases,
      timingSummary: 'Mostly waiting.',
    });
  });

  // The retired numbers are still declared on the AI output schema (#1211 removes
  // the declarations), so a model that keeps volunteering them must not have them
  // land anywhere.
  it('drops prep/cook/total even when the model still returns them', () => {
    expect(
      reconcileEstimatedTimes({ prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 45 }),
    ).toEqual({ phases: [], timingSummary: null });
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
    respond({ phases: [{ label: 'Cook', handsOnMinutes: 20, handsOffMinutes: 35 }] });
    await estimateRecipeTimesFlow(input);
    const { system } = mockGenerate.mock.calls[0]![0] as { system: string };
    expect(system).toContain(TIME_RULES);
  });

  it('sends the ingredient lines and the step timers as the evidence', async () => {
    respond({ phases: [{ label: 'Cook', handsOnMinutes: 20, handsOffMinutes: 35 }] });
    await estimateRecipeTimesFlow(input);
    const { prompt } = mockGenerate.mock.calls[0]![0] as { prompt: string };
    expect(prompt).toContain('2 large onions, finely sliced');
    expect(prompt).toContain('[timer: 20 min]');
    expect(prompt).toContain('Servings: 4');
  });

  it('never shows the model the timing it is replacing', async () => {
    // The stored answer is the thing being corrected, so quoting it back is an
    // anchor towards it. The input schema has no field for it; this pins that the
    // prompt has no back door either.
    respond({ phases: [{ label: 'Cook', handsOnMinutes: 20, handsOffMinutes: 35 }] });
    await estimateRecipeTimesFlow(input);
    const { prompt } = mockGenerate.mock.calls[0]![0] as { prompt: string };
    expect(prompt).not.toMatch(/current|stored|existing/i);
  });

  it('folds an omitted strip to empty before it leaves the flow', async () => {
    respond({});
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      phases: [],
      timingSummary: null,
    });
  });

  // Issue #1122. The phases are handed back untouched — no reconciliation, no
  // zero-fold — because their arithmetic is a sum computed where they are read.
  it('returns the phase strip and its summary untouched', async () => {
    respond({
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

  // A phase of 0 hands-on is an unattended wait, and a real answer. This goes red
  // if anyone reintroduces a zero-fold over the strip.
  it('keeps a phase with no hands-on time rather than folding it away', async () => {
    respond({
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

  // The cap the strip is drawn against (`MAX_RECIPE_PHASES`). Issue #1122
  // review, blocking 3: a seventh block used to fail the WHOLE trust-boundary
  // parse. `AuthoredRecipePhasesSchema`'s `.catch([])` degrades the strip to
  // empty instead — `reconcileEstimatedTimes` then reads that exactly like "the
  // model omitted phases", never as a reason to fail the call. The trigger's
  // `reconcileRecipePhases` is what stops that empty strip erasing a stored one.
  it('degrades a strip longer than six blocks to no strip rather than throwing', async () => {
    respond({
      phases: Array.from({ length: 7 }, (_, i) => ({
        label: `Phase ${i + 1}`,
        handsOnMinutes: 5,
        handsOffMinutes: 0,
      })),
      timingSummary: null,
    });
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      phases: [],
      timingSummary: null,
    });
  });

  // The other half of blocking 3: a fractional or negative phase minute is the
  // same class of lapse as the cap, and degrades the same way.
  it('degrades a strip with a malformed minute to no strip rather than throwing', async () => {
    respond({
      phases: [{ label: 'Prep', handsOnMinutes: 7.5, handsOffMinutes: 0 }],
      timingSummary: null,
    });
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      phases: [],
      timingSummary: null,
    });
  });

  it('throws on an output that fails the trust-boundary parse', async () => {
    // The trigger catches this, leaves `timesEstimatedAt` unstamped, and the
    // script picks the recipe up on its next run. `timingSummary` is the field
    // with no `.catch()` under it, so a wrong TYPE there is still a hard failure.
    respond({ timingSummary: 42 });
    await expect(estimateRecipeTimesFlow(input)).rejects.toThrow(/invalid output/);
  });
});
