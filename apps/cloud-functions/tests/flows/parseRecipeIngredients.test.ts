import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();
const mockUUID = vi.fn();

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

vi.stubGlobal('crypto', { randomUUID: mockUUID });

const { parseRecipeIngredientsFlow } = await import('../../src/flows/parseRecipeIngredients.js');

beforeEach(() => {
  vi.clearAllMocks();
  let counter = 0;
  mockUUID.mockImplementation(() => `id-${++counter}`);
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

type AiIngredient = {
  rawText: string;
  quantity: unknown;
  unit: string | null;
  item: string;
  preparation: string[];
  notes: string | null;
  isOptional: boolean;
  convertedWeight: { value: number; unit: 'g' | 'ml' } | null;
};

function aiOutput(groups: Array<{ name: string | null; items: AiIngredient[] }>) {
  return { groups };
}

function simpleIngredient(overrides: Partial<AiIngredient> & { rawText: string }): AiIngredient {
  return {
    quantity: null,
    unit: null,
    item: overrides.rawText,
    preparation: [],
    notes: null,
    isOptional: false,
    convertedWeight: null,
    ...overrides,
  };
}

// ─── Range quantity ───────────────────────────────────────────────────────────

describe('parseRecipeIngredients — range quantity', () => {
  it('maps a range quantity to the ingredient parsed field', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '2-3 tbsp olive oil',
              quantity: { type: 'range', min: 2, max: 3 },
              unit: 'tbsp',
              item: 'olive oil',
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: '2-3 tbsp olive oil',
    });

    expect(result[0].items[0].rawText).toBe('2-3 tbsp olive oil');
    expect(result[0].items[0].parsed.quantity).toEqual({ type: 'range', min: 2, max: 3 });
    expect(result[0].items[0].parsed.unit).toBe('tbsp');
    expect(result[0].items[0].parsed.item).toBe('olive oil');
  });
});

// ─── Mixed "1 ½" quantity ─────────────────────────────────────────────────────

describe('parseRecipeIngredients — mixed fraction quantity', () => {
  it('maps a mixed fraction to the whole/numerator/denominator form', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '1 ½ cups plain flour, sifted',
              quantity: { type: 'mixed', whole: 1, numerator: 1, denominator: 2 },
              unit: 'cups',
              item: 'plain flour',
              preparation: ['sifted'],
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: '1 ½ cups plain flour, sifted',
    });

    const ingredient = result[0].items[0];
    expect(ingredient.rawText).toBe('1 ½ cups plain flour, sifted');
    expect(ingredient.parsed.quantity).toEqual({
      type: 'mixed',
      whole: 1,
      numerator: 1,
      denominator: 2,
    });
    expect(ingredient.parsed.unit).toBe('cups');
    expect(ingredient.parsed.preparation).toEqual(['sifted']);
  });

  it('handles a bare fraction (whole: 0)', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '½ tsp salt',
              quantity: { type: 'mixed', whole: 0, numerator: 1, denominator: 2 },
              unit: 'tsp',
              item: 'salt',
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({ rawText: '½ tsp salt' });

    expect(result[0].items[0].parsed.quantity).toEqual({
      type: 'mixed',
      whole: 0,
      numerator: 1,
      denominator: 2,
    });
  });
});

// ─── Grouped recipe ───────────────────────────────────────────────────────────

describe('parseRecipeIngredients — grouped recipe', () => {
  it('returns two groups when the AI detects a section header', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '200g pasta',
              quantity: { type: 'single', value: 200 },
              unit: 'g',
              item: 'pasta',
            }),
          ],
        },
        {
          name: 'For the sauce',
          items: [
            simpleIngredient({
              rawText: '2 cloves garlic, crushed',
              quantity: { type: 'single', value: 2 },
              unit: 'cloves',
              item: 'garlic',
              preparation: ['crushed'],
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: '200g pasta\nFor the sauce:\n2 cloves garlic, crushed',
    });

    expect(result).toHaveLength(2);
    expect(result[0].name).toBeNull();
    expect(result[1].name).toBe('For the sauce');
    expect(result[1].items[0].rawText).toBe('2 cloves garlic, crushed');
  });

  it('assigns distinct IDs to groups and their items', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        { name: null, items: [simpleIngredient({ rawText: '1 egg' })] },
        { name: 'Sauce', items: [simpleIngredient({ rawText: '2 tbsp oil' })] },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: '1 egg\nSauce:\n2 tbsp oil',
    });

    const groupIds = result.map((g: { id: string }) => g.id);
    const itemIds = result.flatMap((g: { items: Array<{ id: string }> }) =>
      g.items.map((i) => i.id),
    );
    const allIds = [...groupIds, ...itemIds];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

// ─── Optional garnish ─────────────────────────────────────────────────────────

describe('parseRecipeIngredients — optional garnish', () => {
  it('sets isOptional true when the AI flags an optional ingredient', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: 'fresh parsley to serve (optional)',
              item: 'fresh parsley',
              notes: 'to serve',
              isOptional: true,
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: 'fresh parsley to serve (optional)',
    });

    expect(result[0].items[0].isOptional).toBe(true);
    expect(result[0].items[0].rawText).toBe('fresh parsley to serve (optional)');
  });
});

// ─── Unit conversion ─────────────────────────────────────────────────────────

describe('parseRecipeIngredients — unit conversion', () => {
  it('threads convertedWeight through to the parsed field', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '½ cup butter, melted',
              quantity: { type: 'mixed', whole: 0, numerator: 1, denominator: 2 },
              unit: 'cup',
              item: 'butter',
              preparation: ['melted'],
              convertedWeight: { value: 113, unit: 'g' },
            }),
            simpleIngredient({
              rawText: '1 tbsp olive oil',
              quantity: { type: 'single', value: 1 },
              unit: 'tbsp',
              item: 'olive oil',
              convertedWeight: { value: 15, unit: 'ml' },
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: '½ cup butter, melted\n1 tbsp olive oil',
    });

    expect(result[0].items[0].parsed.convertedWeight).toEqual({ value: 113, unit: 'g' });
    expect(result[0].items[1].parsed.convertedWeight).toEqual({ value: 15, unit: 'ml' });
  });

  it('passes null convertedWeight through unchanged', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '2 cloves garlic',
              item: 'garlic',
              convertedWeight: null,
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({ rawText: '2 cloves garlic' });

    expect(result[0].items[0].parsed.convertedWeight).toBeNull();
  });
});

// ─── Domain invariants ────────────────────────────────────────────────────────

describe('parseRecipeIngredients — domain invariants on every item', () => {
  it('sets matchState pending, canonId null, firstUsedInStepId null', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '1 egg',
              item: 'egg',
              quantity: { type: 'single', value: 1 },
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({ rawText: '1 egg' });

    const item = result[0].items[0];
    expect(item.matchState).toBe('pending');
    expect(item.canonId).toBeNull();
    expect(item.firstUsedInStepId).toBeNull();
  });

  it('assigns unique IDs to each group and ingredient', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({ rawText: '1 egg' }),
            simpleIngredient({ rawText: '200ml milk' }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({ rawText: '1 egg\n200ml milk' });

    // group id + 2 item ids = 3 distinct values from the counter
    expect(result[0].id).toBe('id-1');
    expect(result[0].items[0].id).toBe('id-2');
    expect(result[0].items[1].id).toBe('id-3');
  });
});

// ─── Prompt construction ──────────────────────────────────────────────────────

describe('parseRecipeIngredients — prompt construction', () => {
  it('passes the rawText verbatim as the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput([{ name: null, items: [] }]) });

    await (parseRecipeIngredientsFlow as Function)({ rawText: '1 cup flour\n2 eggs' });

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.prompt).toBe('1 cup flour\n2 eggs');
  });

  it('passes temperature 0 and an output schema to generate', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput([{ name: null, items: [] }]) });

    await (parseRecipeIngredientsFlow as Function)({ rawText: '1 cup flour' });

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.config).toEqual({ temperature: 0 });
    expect(opts.output?.schema).toBeDefined();
  });

  it('includes rawText preservation instructions in the system prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput([{ name: null, items: [] }]) });

    await (parseRecipeIngredientsFlow as Function)({ rawText: '1 cup flour' });

    const { system } = mockGenerate.mock.calls[0]![0];
    expect(system).toContain('rawText');
    expect(system).toContain('verbatim');
  });
});
