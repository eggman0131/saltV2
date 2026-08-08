import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerate, mockGet, mockDoc, mockCollection, mockFlowModel } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockDoc = vi.fn(() => ({ get: mockGet }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  return {
    mockGenerate: vi.fn(),
    mockGet,
    mockDoc,
    mockCollection,
    mockFlowModel: vi.fn().mockResolvedValue('gemini-pro-latest'),
  };
});

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));

// Stub withAiTimeout to call op() directly — timeout/retry logic is tested elsewhere.
vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));

vi.mock('../../src/ai/fakeModel.js', () => ({
  flowModel: mockFlowModel,
}));

const { generateGuidedPlanFlow } = await import('../../src/flows/generateGuidedPlan.js');
const run = generateGuidedPlanFlow as unknown as (input: { recipeId: string }) => Promise<{
  prep: unknown[];
  stepNotes: { stepId: string }[];
}>;

const RECIPE = {
  id: 'recipe-1',
  schemaVersion: 1,
  kind: 'recipe',
  title: 'Ragù',
  description: 'A long-simmered sauce.',
  ingredients: [
    {
      id: 'grp-1',
      name: null,
      items: [
        {
          id: 'ing-1',
          rawText: '1 onion',
          parsed: null,
          canonId: null,
          matchState: 'pending',
          isOptional: false,
          firstUsedInStepId: null,
        },
      ],
    },
  ],
  steps: [
    {
      id: 'step-1',
      text: 'Soften the onion.',
      timer: { durationMinutes: 10, description: null },
      note: null,
    },
  ],
  metadata: {
    servings: 4,
    totalTimeMinutes: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    tags: [],
  },
  source: null,
  notes: null,
  image: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const AI_OUTPUT = {
  prep: [{ text: 'Dice the onion finely', container: 'small bowl', ingredientIds: ['ing-1'] }],
  stepNotes: [
    {
      stepId: 'step-1',
      container: 'the small bowl',
      setup: 'small hob burner, medium-low',
      cue: 'a very gentle sizzle, not a crackle',
      checkIns: [{ atMinutes: 5, text: 'give it a stir' }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFlowModel.mockResolvedValue('gemini-pro-latest');
  mockGet.mockResolvedValue({ exists: true, data: () => RECIPE });
});

describe('generateGuidedPlan', () => {
  it('reads the recipe server-side by id and returns the authored plan', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });

    const result = await run({ recipeId: 'recipe-1' });

    expect(mockCollection).toHaveBeenCalledWith('recipes');
    expect(mockDoc).toHaveBeenCalledWith('recipe-1');
    expect(result).toEqual(AI_OUTPUT);
  });

  it('runs on the `pro` role — cue quality IS the feature', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    expect(mockFlowModel).toHaveBeenCalledWith('pro', 'generateGuidedPlan');
  });

  it('shows the model the ingredient and step IDS, and each step timer', async () => {
    // The output references those ids — an ingredient id per prep job, a step id
    // per note — and a model that cannot see an id cannot cite it. The timer is
    // shown because a check-in must land strictly inside it.
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    const prompt = String(mockGenerate.mock.calls[0][0].prompt);
    expect(prompt).toContain('[ing-1] 1 onion');
    expect(prompt).toContain('[step-1]');
    expect(prompt).toContain('timer: 10 minutes');
  });

  it('drops a note for a step the recipe does not have', async () => {
    // A hallucinated step id would render as nothing in the editor anyway; storing
    // it makes every later reader handle a note the cook can never see.
    mockGenerate.mockResolvedValue({
      output: {
        ...AI_OUTPUT,
        stepNotes: [
          ...AI_OUTPUT.stepNotes,
          { stepId: 'step-99', container: null, setup: null, cue: 'invented', checkIns: [] },
        ],
      },
    });

    const result = await run({ recipeId: 'recipe-1' });

    expect(result.stepNotes.map((n) => n.stepId)).toEqual(['step-1']);
  });

  it('throws when the recipe does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false, data: () => undefined });
    await expect(run({ recipeId: 'nope' })).rejects.toThrow();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('throws when the stored recipe fails validation', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ id: 'recipe-1', schemaVersion: 2 }) });
    await expect(run({ recipeId: 'recipe-1' })).rejects.toThrow();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('throws when the model output is not the expected shape', async () => {
    mockGenerate.mockResolvedValue({ output: { prep: 'not a list' } });
    await expect(run({ recipeId: 'recipe-1' })).rejects.toThrow(/invalid output/);
  });
});
