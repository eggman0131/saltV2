import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();
const mockUUID = vi.fn();
const mockParseFlow = vi.fn();
const mockCanonFlow = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));

vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: { model: (name: string) => name },
}));

// Stub withAiTimeout to call op() directly — timeout/retry logic is tested in its own suite.
vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));

// The librarian flow calls the parse and canon sibling flows — mock them so no AI
// round-trips happen and we control exactly what `parsed` data is threaded through.
vi.mock('../../src/flows/parseRecipeIngredients.js', () => ({
  parseRecipeIngredientsFlow: mockParseFlow,
}));

vi.mock('../../src/flows/canonicaliseRecipeIngredients.js', () => ({
  canonicaliseRecipeIngredientsFlow: mockCanonFlow,
}));

// Edit mode reads the base recipe from Firestore via getFirestore(); mock the
// thin chain it uses (collection → doc → get). mockGet controls the snapshot.
const mockGet = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: mockGet }) }) }),
}));

vi.mock('firebase-functions', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.stubGlobal('crypto', { randomUUID: mockUUID });

const { authorRecipeFlow } = await import('../../src/flows/authorRecipe.js');

beforeEach(() => {
  vi.clearAllMocks();
  let counter = 0;
  mockUUID.mockImplementation(() => `id-${++counter}`);
  // Default: canon returns nothing, so ingredients land as pending.
  mockCanonFlow.mockResolvedValue([]);
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function librarianOutput() {
  return {
    title: 'Garlic Pasta',
    description: null,
    servings: 2,
    totalTimeMinutes: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    tags: [],
    ingredientGroups: [
      {
        name: null,
        ingredients: [
          { rawText: '200g pasta', isOptional: false, firstUsedInStepOrdinal: 0 },
          { rawText: '2 cloves garlic, crushed', isOptional: false, firstUsedInStepOrdinal: 1 },
        ],
      },
    ],
    steps: [
      { text: 'Boil the pasta.', timerMinutes: null, note: null },
      { text: 'Crush the garlic.', timerMinutes: null, note: null },
    ],
    notes: null,
  };
}

// A parse-flow result mirroring parseRecipeIngredientsFlow's output shape: an
// array of groups, each with items carrying a full `parsed` object keyed by rawText.
function parseResult() {
  return [
    {
      id: 'parse-group-1',
      name: null,
      items: [
        {
          id: 'parse-item-1',
          rawText: '200g pasta',
          parsed: {
            quantity: { type: 'single', value: 200 },
            unit: 'g',
            item: 'pasta',
            preparation: [],
            notes: null,
            displayText: null,
          },
          canonId: null,
          matchState: 'pending' as const,
          isOptional: false,
          firstUsedInStepId: null,
        },
        {
          id: 'parse-item-2',
          rawText: '2 cloves garlic, crushed',
          parsed: {
            quantity: { type: 'single', value: 2 },
            unit: null,
            item: 'garlic',
            preparation: ['crushed'],
            notes: null,
            displayText: null,
          },
          canonId: null,
          matchState: 'pending' as const,
          isOptional: false,
          firstUsedInStepId: null,
        },
      ],
    },
  ];
}

// A valid RecipeDoc for the base recipe Firestore read in edit mode.
function baseRecipeDoc() {
  return {
    id: 'r1',
    schemaVersion: 1 as const,
    title: 'Çoban Salatası',
    description: 'A crisp Turkish shepherd salad.',
    ingredients: [
      {
        id: 'g1',
        name: null,
        items: [
          {
            id: 'i1',
            rawText: '2 cucumbers, diced',
            parsed: {
              quantity: { type: 'single', value: 2 },
              unit: null,
              item: 'cucumber',
              preparation: ['diced'],
              notes: null,
              displayText: null,
            },
            canonId: 'canon-cucumber',
            matchState: 'matched' as const,
            isOptional: false,
            firstUsedInStepId: null,
          },
          {
            id: 'i2',
            rawText: '3 tomatoes, diced',
            parsed: null,
            canonId: 'canon-tomato',
            matchState: 'matched' as const,
            isOptional: false,
            firstUsedInStepId: null,
          },
        ],
      },
    ],
    steps: [
      { id: 's1', text: 'Dice the vegetables.', timer: null, note: null },
      { id: 's2', text: 'Toss with dressing.', timer: null, note: null },
    ],
    metadata: {
      servings: 4,
      totalTimeMinutes: 15,
      prepTimeMinutes: 15,
      cookTimeMinutes: null,
      tags: ['turkish', 'salad'],
    },
    source: { type: 'manual' as const },
    notes: null,
    image: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

// A librarian edit output: the two base ingredients returned verbatim (so they
// count as unchanged) plus one genuinely new ingredient (feta).
function librarianEditOutput() {
  return {
    ...librarianOutput(),
    title: 'Çoban Salatası',
    ingredientGroups: [
      {
        name: null,
        ingredients: [
          { rawText: '2 cucumbers, diced', isOptional: false, firstUsedInStepOrdinal: 0 },
          { rawText: '3 tomatoes, diced', isOptional: false, firstUsedInStepOrdinal: 0 },
          { rawText: '100g feta, crumbled', isOptional: false, firstUsedInStepOrdinal: 1 },
        ],
      },
    ],
  };
}

// ─── edit-mode grounding ─────────────────────────────────────────────────────────

describe('authorRecipe — edit-mode grounding', () => {
  beforeEach(() => {
    mockGenerate.mockResolvedValue({ output: librarianOutput() });
    mockParseFlow.mockResolvedValue([]);
  });

  function systemPromptFrom(): string {
    return (mockGenerate.mock.calls[0]![0] as { system: string }).system;
  }

  it('grounds the librarian on the existing recipe when recipeId is provided', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => baseRecipeDoc() });

    await (authorRecipeFlow as Function)({
      messages: [
        { id: 'm1', role: 'user', text: 'add some cheese', createdAt: '2026-06-27T00:00:00.000Z' },
      ],
      existingTags: [],
      recipeId: 'r1',
    });

    const system = systemPromptFrom();
    // Edit-mode instructions present…
    expect(system).toContain('Editing an existing recipe');
    expect(system).toContain('Return the COMPLETE updated recipe');
    // …the base recipe is injected verbatim…
    expect(system).toContain('Çoban Salatası');
    expect(system).toContain('2 cucumbers, diced');
    expect(system).toContain('3 tomatoes, diced');
    // …and the create-mode "only what's in the conversation" guardrail is gone.
    expect(system).not.toContain('Extract only what is present in the conversation');
  });

  it('uses create mode and never reads Firestore when recipeId is absent', async () => {
    await (authorRecipeFlow as Function)({ messages: [], existingTags: [] });

    const system = systemPromptFrom();
    expect(system).toContain('Extract only what is present in the conversation');
    expect(system).not.toContain('Editing an existing recipe');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to create mode when the base recipe does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });

    await (authorRecipeFlow as Function)({ messages: [], existingTags: [], recipeId: 'missing' });

    const system = systemPromptFrom();
    expect(system).toContain('Extract only what is present in the conversation');
    expect(system).not.toContain('Editing an existing recipe');
  });

  it('falls back to create mode when the base recipe fails validation', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ id: 'r1', schemaVersion: 99 }) });

    await (authorRecipeFlow as Function)({ messages: [], existingTags: [], recipeId: 'r1' });

    const system = systemPromptFrom();
    expect(system).toContain('Extract only what is present in the conversation');
    expect(system).not.toContain('Editing an existing recipe');
  });
});

// ─── edit-mode diff (skip re-parse/re-embed of unchanged ingredients) ────────────

describe('authorRecipe — edit-mode diff', () => {
  beforeEach(() => {
    mockGenerate.mockResolvedValue({ output: librarianEditOutput() });
    mockParseFlow.mockResolvedValue([]);
    mockGet.mockResolvedValue({ exists: true, data: () => baseRecipeDoc() });
    // Canon returns a fresh match for the single new ingredient (feta).
    mockCanonFlow.mockResolvedValue([
      { kind: 'ok', value: { decision: 'created', item: { id: 'canon-feta' } } },
    ]);
  });

  async function runEdit() {
    return (await (authorRecipeFlow as Function)({
      messages: [
        { id: 'm1', role: 'user', text: 'add some cheese', createdAt: '2026-06-27T00:00:00.000Z' },
      ],
      existingTags: [],
      recipeId: 'r1',
    })) as {
      ingredients: { items: Record<string, unknown>[] }[];
    };
  }

  it('sends only the new/edited ingredient to the parse and canon flows', async () => {
    await runEdit();

    // Both expensive (embedding) flows run exactly once, over just the feta.
    expect(mockParseFlow).toHaveBeenCalledTimes(1);
    expect(mockParseFlow).toHaveBeenCalledWith({ rawText: '100g feta, crumbled' });

    expect(mockCanonFlow).toHaveBeenCalledTimes(1);
    const canonItems = mockCanonFlow.mock.calls[0]![0].items as { rawText: string }[];
    expect(canonItems).toHaveLength(1);
    expect(canonItems[0]!.rawText).toBe('100g feta, crumbled');
  });

  it('carries over canon match, parsed data, and id for unchanged ingredients', async () => {
    const doc = await runEdit();
    const items = doc.ingredients[0]!.items;

    const cucumber = items.find((i) => i['rawText'] === '2 cucumbers, diced')!;
    expect(cucumber['id']).toBe('i1');
    expect(cucumber['canonId']).toBe('canon-cucumber');
    expect(cucumber['matchState']).toBe('matched');
    expect((cucumber['parsed'] as { item: string }).item).toBe('cucumber');

    const tomato = items.find((i) => i['rawText'] === '3 tomatoes, diced')!;
    expect(tomato['canonId']).toBe('canon-tomato');
    expect(tomato['matchState']).toBe('matched');
  });

  it('matches the new ingredient via the canon flow', async () => {
    const doc = await runEdit();
    const feta = doc.ingredients[0]!.items.find((i) => i['rawText'] === '100g feta, crumbled')!;
    expect(feta['canonId']).toBe('canon-feta');
    expect(feta['matchState']).toBe('matched');
  });
});

// ─── parsed threading ──────────────────────────────────────────────────────────

describe('authorRecipe — parsed threading', () => {
  it('threads the full parsed object (quantity/unit/item) onto each assembled ingredient', async () => {
    mockGenerate.mockResolvedValue({ output: librarianOutput() });
    mockParseFlow.mockResolvedValue(parseResult());

    const doc = await (authorRecipeFlow as Function)({ messages: [], existingTags: [] });

    const items = doc.ingredients[0].items;

    // Quantified ingredient — parsed must be non-null with quantity/unit threaded through.
    const pasta = items.find((i: { rawText: string }) => i.rawText === '200g pasta');
    expect(pasta.parsed).not.toBeNull();
    expect(pasta.parsed.quantity).toEqual({ type: 'single', value: 200 });
    expect(pasta.parsed.unit).toBe('g');
    expect(pasta.parsed.item).toBe('pasta');

    const garlic = items.find((i: { rawText: string }) => i.rawText === '2 cloves garlic, crushed');
    expect(garlic.parsed).not.toBeNull();
    expect(garlic.parsed.quantity).toEqual({ type: 'single', value: 2 });
    expect(garlic.parsed.unit).toBeNull();
    expect(garlic.parsed.item).toBe('garlic');
    expect(garlic.parsed.preparation).toEqual(['crushed']);
  });

  it('reuses the single parse call — does not invoke parseRecipeIngredientsFlow more than once', async () => {
    mockGenerate.mockResolvedValue({ output: librarianOutput() });
    mockParseFlow.mockResolvedValue(parseResult());

    await (authorRecipeFlow as Function)({ messages: [], existingTags: [] });

    expect(mockParseFlow).toHaveBeenCalledTimes(1);
  });

  it('falls back to parsed: null when no parse result matches the rawText', async () => {
    mockGenerate.mockResolvedValue({ output: librarianOutput() });
    // Parse returns a result for pasta only; garlic has no match → parsed null.
    mockParseFlow.mockResolvedValue([
      {
        id: 'parse-group-1',
        name: null,
        items: [parseResult()[0].items[0]],
      },
    ]);

    const doc = await (authorRecipeFlow as Function)({ messages: [], existingTags: [] });
    const items = doc.ingredients[0].items;

    const pasta = items.find((i: { rawText: string }) => i.rawText === '200g pasta');
    const garlic = items.find((i: { rawText: string }) => i.rawText === '2 cloves garlic, crushed');

    expect(pasta.parsed).not.toBeNull();
    expect(garlic.parsed).toBeNull();
  });

  it('falls back to parsed: null on every ingredient when the parse flow throws', async () => {
    mockGenerate.mockResolvedValue({ output: librarianOutput() });
    mockParseFlow.mockRejectedValue(new Error('parse failed'));

    const doc = await (authorRecipeFlow as Function)({ messages: [], existingTags: [] });
    const items = doc.ingredients[0].items;

    expect(items.every((i: { parsed: unknown }) => i.parsed === null)).toBe(true);
  });
});
