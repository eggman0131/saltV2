import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AI_FLOW_ROLES } from '@salt/domain/schemas';

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
// Bypass the real timer, but keep everything else the module exports (the
// shared budget constant, the stream guard) — a factory that lists only
// `withAiTimeout` goes stale the moment the module grows.
vi.mock('../../src/adapters/withAiTimeout.js', async (importActual) => ({
  ...(await importActual<object>()),
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
    tags: [],
  },
  source: null,
  notes: null,
  image: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

// A CORRECT plan, and it has to be: the container name is the only join between
// the two halves, so a fixture whose note says "the small bowl" about a job that
// filled a "small bowl" models a plan whose step can never show its contents
// (issue #761). The name is unique, says what is in the bowl, and is copied
// character for character onto the note — and the prep text gives a dimension
// rather than "finely".
const AI_OUTPUT = {
  prep: [
    { text: 'Dice the onion into 5mm dice', container: 'onion bowl', ingredientIds: ['ing-1'] },
  ],
  stepNotes: [
    {
      stepId: 'step-1',
      container: 'onion bowl',
      setup: 'small hob burner, medium-low',
      cue: 'a very gentle sizzle, not a crackle',
      checkIns: [{ atMinutes: 5, text: 'give it a stir' }],
      lookahead: 'the onions soften',
      getAhead: null,
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
    expect(mockFlowModel).toHaveBeenCalledWith('generateGuidedPlan');
    expect(AI_FLOW_ROLES.generateGuidedPlan).toBe('pro');
  });

  it('shows the model the ingredient and step IDS, and each step timer', async () => {
    // The output references those ids — an ingredient id per prep job, a step id
    // per note — and a model that cannot see an id cannot cite it. The timer is
    // shown because a check-in must land strictly inside it.
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    const prompt = String(mockGenerate.mock.calls[0]![0].prompt);
    expect(prompt).toContain('[ing-1] 1 onion');
    expect(prompt).toContain('[step-1]');
    expect(prompt).toContain('timer: 10 minutes');
  });

  it('tells the model the container rules that make the plan joinable', async () => {
    // The prep/step-note halves join on the container NAME and nothing else, so the
    // two rules that keep that name resolvable — unique per job, verbatim on the
    // note — have to actually reach the model. They ride the system prompt.
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    const system = String(mockGenerate.mock.calls[0]![0].system);
    expect(system).toContain('EVERY CONTAINER NAME MUST BE UNIQUE ACROSS THE WHOLE PREP LIST');
    expect(system).toContain('COPIED VERBATIM');
  });

  it('stores a note whose container no job fills, exactly as authored', async () => {
    // Deliberately NOT filtered or rejected. A container name that does not resolve
    // costs a step its contents and nothing more — the plan is still cookable, and
    // the editor is where it gets fixed, so dropping the note here would delete the
    // cue and setup the model got right along with the one word it got wrong.
    mockGenerate.mockResolvedValue({
      output: {
        ...AI_OUTPUT,
        stepNotes: [{ ...AI_OUTPUT.stepNotes[0], container: 'the tureen' }],
      },
    });

    const result = (await run({ recipeId: 'recipe-1' })) as unknown as {
      stepNotes: { container: string | null }[];
    };

    expect(result.stepNotes).toHaveLength(1);
    expect(result.stepNotes[0]!.container).toBe('the tureen');
  });

  it('drops a note for a step the recipe does not have', async () => {
    // A hallucinated step id would render as nothing in the editor anyway; storing
    // it makes every later reader handle a note the cook can never see.
    mockGenerate.mockResolvedValue({
      output: {
        ...AI_OUTPUT,
        stepNotes: [
          ...AI_OUTPUT.stepNotes,
          {
            stepId: 'step-99',
            container: null,
            setup: null,
            cue: 'invented',
            checkIns: [],
            lookahead: 'invented too',
            getAhead: null,
          },
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
