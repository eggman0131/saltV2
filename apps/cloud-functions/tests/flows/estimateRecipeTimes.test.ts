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

const { estimateRecipeTimesFlow } = await import('../../src/flows/estimateRecipeTimes.js');
const { PHASE_RULES } = await import('../../src/flows/recipeFieldRules.js');

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

describe('estimateRecipeTimesFlow', () => {
  it('asks against the SHARED field DEFINITIONS, not a copy of them', async () => {
    // The load-bearing assertion of this file — precise about which half is
    // shared. If the backfill ever measures recipes against its own
    // hand-written field definitions, the library goes back to being split
    // between two of them — which is the whole of issue #952. The estimation
    // HEURISTICS below PHASE_RULES are a separate, flow-local half not covered
    // by this assertion — see the "FIELD DEFINITIONS... ESTIMATION HEURISTICS"
    // header comment in estimateRecipeTimes.ts.
    respond({ prepTimeMinutes: 20, cookTimeMinutes: 35, totalTimeMinutes: 55 });
    await estimateRecipeTimesFlow(input);
    const { system } = mockGenerate.mock.calls[0]![0] as { system: string };
    expect(system).toContain(PHASE_RULES);
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

  it('returns the strip and the summary, and nothing else', async () => {
    // Issue #1233: the flow's whole answer is the timing the app displays. The
    // model may still echo the three retired numbers — they are `.optional()` on
    // the output schema until #1211 deletes them — and they must not reach the
    // caller, because the trigger writes what this returns.
    respond({ prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 45 });
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      phases: [],
      timingSummary: null,
    });
  });

  // Issue #1122. The phases are handed back untouched — no reconciliation, no
  // zero-fold — because their arithmetic is a sum computed where they are read.
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

  // A phase of 0 hands-on is an unattended wait — a real answer, and NOT a glitch
  // to fold away. This goes red if anyone adds a zero-fold over the strip.
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

  // The cap the strip is drawn against (`MAX_RECIPE_PHASES`). Issue #1122
  // review, blocking 3: a seventh block used to fail the WHOLE trust-boundary
  // parse. `AuthoredRecipePhasesSchema`'s `.catch([])` degrades the strip to
  // empty instead, which the flow reads exactly like "the model omitted phases"
  // — never as a reason to fail the call and force a backfill retry.
  it('degrades a strip longer than six blocks to no strip, rather than failing', async () => {
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
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      phases: [],
      timingSummary: null,
    });
  });

  // The other half of blocking 3: a fractional or negative phase minute is the
  // same class of lapse as the cap, and degrades the same way.
  it('degrades a strip with a malformed minute to no strip, rather than failing', async () => {
    respond({
      prepTimeMinutes: 20,
      cookTimeMinutes: 35,
      totalTimeMinutes: 55,
      phases: [{ label: 'Prep', handsOnMinutes: 7.5, handsOffMinutes: 0 }],
      timingSummary: null,
    });
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      phases: [],
      timingSummary: null,
    });
  });

  // Issue #1233 review, blocking 1: the three time numbers are no longer asked
  // for and nothing reads them, so a malformed value on one of them (a fractional
  // minute, a `0` the range gate rejects) must not take the whole re-estimate
  // down — it degrades to null the same way an over-cap or malformed `phases`
  // degrades to `[]`. A perfect phase strip must not be thrown away over a field
  // invisible to the user.
  it('degrades a malformed retired time field to null, rather than failing', async () => {
    respond({
      prepTimeMinutes: 12.5,
      cookTimeMinutes: 35,
      totalTimeMinutes: 0,
      phases: [{ label: 'Prep', handsOnMinutes: 20, handsOffMinutes: 0 }],
      timingSummary: 'About 20 minutes.',
    });
    await expect(estimateRecipeTimesFlow(input)).resolves.toEqual({
      phases: [{ label: 'Prep', handsOnMinutes: 20, handsOffMinutes: 0 }],
      timingSummary: 'About 20 minutes.',
    });
  });

  it('throws on an output that fails the trust-boundary parse', async () => {
    // `phases` is the one field left whose shape the flow actually depends on —
    // a summary of the wrong TYPE (not a string or null) is not a range the
    // decorative time fields' `.catch(null)` can absorb, because it never reaches
    // that gate: the object itself is malformed.
    respond({ prepTimeMinutes: 20, cookTimeMinutes: 35, totalTimeMinutes: 55, timingSummary: 42 });
    await expect(estimateRecipeTimesFlow(input)).rejects.toThrow(/invalid output/);
  });
});
