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
