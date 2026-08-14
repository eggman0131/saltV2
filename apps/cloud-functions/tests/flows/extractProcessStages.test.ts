import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { mockGenerate, mockGet, mockDoc, mockCollection, mockFlowModel } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockDoc = vi.fn(() => ({ get: mockGet }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  return {
    mockGenerate: vi.fn(),
    mockGet,
    mockDoc,
    mockCollection,
    mockFlowModel: vi.fn().mockResolvedValue('gemini-flash-lite-latest'),
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

const { extractProcessStagesFlow, STAGE_KIND_RULES } =
  await import('../../src/flows/extractProcessStages.js');
type Stage = {
  label: string;
  kind: 'active' | 'wait';
  environment: { celsius: number } | null;
  duration: { kind: 'fixed'; minutes: number } | null;
  until: string | null;
  stepId: string | null;
};
const run = extractProcessStagesFlow as unknown as (input: {
  recipeId: string;
}) => Promise<{ stages: Stage[] }>;

// A real bread shape: the two things the spike got wrong are both in here. The
// method has a preheat AND a bake (which side the oven falls on), and it has a
// single sentence carrying more than one rest (the one extraction swallowed).
const LOAF = {
  id: 'recipe-1',
  schemaVersion: 1,
  kind: 'recipe',
  title: 'Overnight white tin',
  description: 'A slow loaf.',
  ingredients: [],
  steps: [
    { id: 'step-1', text: 'Mix the flour, water, salt and yeast.', timer: null, note: null },
    {
      id: 'step-2',
      text: 'Leave it to bulk ferment.',
      timer: { durationMinutes: 240, description: null },
      note: null,
    },
    { id: 'step-3', text: 'Preheat the oven to 230°C.', timer: null, note: null },
    {
      id: 'step-4',
      text: 'Bake.',
      timer: { durationMinutes: 40, description: null },
      note: null,
    },
  ],
  metadata: {
    servings: 1,
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

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    label: 'Bulk ferment',
    kind: 'wait',
    environment: { celsius: 20 },
    duration: { kind: 'fixed', minutes: 240 },
    until: null,
    stepId: 'step-2',
    ...overrides,
  };
}

const AI_OUTPUT = {
  stages: [
    stage({ label: 'Mix', kind: 'active', environment: null, stepId: 'step-1' }),
    stage(),
    stage({
      label: 'Preheat the oven',
      kind: 'wait',
      environment: { celsius: 230 },
      duration: { kind: 'fixed', minutes: 20 },
      stepId: 'step-3',
    }),
    stage({
      label: 'Bake',
      kind: 'active',
      environment: { celsius: 230 },
      duration: { kind: 'fixed', minutes: 40 },
      stepId: 'step-4',
    }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFlowModel.mockResolvedValue('gemini-flash-lite-latest');
  mockGet.mockResolvedValue({ exists: true, data: () => LOAF });
});

describe('extractProcessStages', () => {
  it('reads the recipe server-side by id and returns the stages in order', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });

    const result = await run({ recipeId: 'recipe-1' });

    expect(mockCollection).toHaveBeenCalledWith('recipes');
    expect(mockDoc).toHaveBeenCalledWith('recipe-1');
    expect(result.stages.map((s) => s.label)).toEqual([
      'Mix',
      'Bulk ferment',
      'Preheat the oven',
      'Bake',
    ]);
  });

  it('runs on the cheap tier — this is transcription, not judgement', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    expect(mockFlowModel).toHaveBeenCalledWith('lite', 'extractProcessStages');
    // Temperature 0 for the same reason: there is one correct reading of a method,
    // and every degree of creativity is a degree of invented proof.
    expect(mockGenerate.mock.calls[0][0].config).toEqual({ temperature: 0 });
  });

  it('shows the model each step id and the timer already parsed onto it', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    const prompt = String(mockGenerate.mock.calls[0][0].prompt);
    expect(prompt).toContain('[step-2]');
    expect(prompt).toContain('timer: 240 minutes');
  });
});

describe('extractProcessStages — which side the oven falls on', () => {
  // THE SPIKE'S HEADLINE DEFECT. The bake came back labelled differently on each of
  // three bread recipes because nothing anywhere said whether an oven is attended.
  // The fix is a definition that exists exactly once and is quoted, not paraphrased.

  it('states the rule in the prompt, verbatim, with the bake pinned', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    const system = String(mockGenerate.mock.calls[0][0].system);
    expect(system).toContain(STAGE_KIND_RULES);
    expect(system).toContain('THE BAKE IS `active`. THE PREHEAT IS `wait`.');
  });

  it('says the same thing as the schema the stages are stored under', async () => {
    // The drift guard. The definition lives in ProcessStageKindSchema's field docs
    // AND in this prompt; a change to one that is not made to the other is exactly
    // how the bake starts moving between recipes again. Compared sentence by
    // sentence rather than as one blob, because the two are wrapped differently.
    const schemaSource = readFileSync(
      fileURLToPath(new URL('../../../../packages/domain/src/schemas/process.ts', import.meta.url)),
      'utf8',
    );
    // Comment prefixes, line wrapping and which words are SHOUTED differ between a
    // code comment and a prompt; the words themselves must not.
    const flatten = (text: string) =>
      text
        .replace(/^\s*\/\/ ?/gm, '')
        .replace(/\s+/g, ' ')
        .toUpperCase();
    const schemaText = flatten(schemaSource);
    const promptText = flatten(STAGE_KIND_RULES);

    for (const sentence of [
      'A `wait` is unattended change — the dough, the ferment or the oven changes on its own and the cook can leave the room: bulk fermentation, proving, a fridge retard, resting, curing, and an oven coming up to temperature.',
      'An `active` stage is one the cook carries out and is present for: mixing, folding, shaping, and the bake itself.',
      'The bake is `active`. The preheat is `wait`.',
    ]) {
      expect(promptText).toContain(sentence.toUpperCase());
      expect(schemaText).toContain(sentence.toUpperCase());
    }
  });
});

describe('extractProcessStages — a recipe with nothing to wait for', () => {
  it('returns nothing rather than inventing a proof', async () => {
    // Enforced in code, not merely asked for in the prompt: a model told to list
    // stages will always find some, and the difference between "this has no
    // process" and a confidently invented rise is the whole feature. The actives
    // are only worth returning as the gaps BETWEEN waits.
    mockGenerate.mockResolvedValue({
      output: {
        stages: [
          stage({ label: 'Mix', kind: 'active', stepId: 'step-1' }),
          stage({ label: 'Bake', kind: 'active', stepId: 'step-4' }),
        ],
      },
    });

    const result = await run({ recipeId: 'recipe-1' });

    expect(result.stages).toEqual([]);
  });

  it('tells the model so as well', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    await run({ recipeId: 'recipe-1' });
    const system = String(mockGenerate.mock.calls[0][0].system);
    expect(system).toContain('NEVER invent a proof');
  });
});

describe('extractProcessStages — hallucinated step ids', () => {
  it('drops the citation, not the stage', async () => {
    // Deliberately GENTLER than generateGuidedPlan, which drops the whole note: a
    // note IS an annotation on a step and is nothing without one, whereas `stepId`
    // is an optional one-way back-reference and a bulk ferment is still a bulk
    // ferment without it. Losing a real wait to a mistyped id is the loss this
    // feature exists to prevent.
    mockGenerate.mockResolvedValue({
      output: { stages: [stage({ stepId: 'step-99' })] },
    });

    const result = await run({ recipeId: 'recipe-1' });

    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]!.label).toBe('Bulk ferment');
    expect(result.stages[0]!.stepId).toBeNull();
  });

  it('leaves a real step id alone', async () => {
    mockGenerate.mockResolvedValue({ output: AI_OUTPUT });
    const result = await run({ recipeId: 'recipe-1' });
    expect(result.stages.map((s) => s.stepId)).toEqual(['step-1', 'step-2', 'step-3', 'step-4']);
  });
});

describe('extractProcessStages — the trust boundaries', () => {
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
    mockGenerate.mockResolvedValue({ output: { stages: 'not a list' } });
    await expect(run({ recipeId: 'recipe-1' })).rejects.toThrow(/invalid output/);
  });
});
