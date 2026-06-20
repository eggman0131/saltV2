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
  unit: 'g' | 'ml' | null;
  item: string;
  preparation: string[];
  notes: string | null;
  isOptional: boolean;
  displayText: string | null;
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
    displayText: null,
    ...overrides,
  };
}

// ─── Range quantity ───────────────────────────────────────────────────────────

describe('parseRecipeIngredients — range quantity', () => {
  it('maps a range quantity (in metric ml) to the ingredient parsed field', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '2-3 tbsp olive oil',
              quantity: { type: 'range', min: 30, max: 45 },
              unit: 'ml',
              item: 'olive oil',
              displayText: '2-3 tbsp',
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: '2-3 tbsp olive oil',
    });

    expect(result[0].items[0].rawText).toBe('2-3 tbsp olive oil');
    expect(result[0].items[0].parsed.quantity).toEqual({ type: 'range', min: 30, max: 45 });
    expect(result[0].items[0].parsed.unit).toBe('ml');
    expect(result[0].items[0].parsed.displayText).toBe('2-3 tbsp');
    expect(result[0].items[0].parsed.item).toBe('olive oil');
  });
});

// ─── Non-metric source quantities ────────────────────────────────────────────

describe('parseRecipeIngredients — non-metric source quantities', () => {
  it('stores metric equivalent and original displayText for cup measures', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '1 ½ cups plain flour, sifted',
              quantity: { type: 'single', value: 180 },
              unit: 'g',
              item: 'plain flour',
              preparation: ['sifted'],
              displayText: '1½ cups',
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
    expect(ingredient.parsed.quantity).toEqual({ type: 'single', value: 180 });
    expect(ingredient.parsed.unit).toBe('g');
    expect(ingredient.parsed.displayText).toBe('1½ cups');
    expect(ingredient.parsed.preparation).toEqual(['sifted']);
  });

  it('stores metric ml and original displayText for tsp measures', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '½ tsp salt',
              quantity: { type: 'single', value: 2.5 },
              unit: 'ml',
              item: 'salt',
              displayText: '½ tsp',
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({ rawText: '½ tsp salt' });

    expect(result[0].items[0].parsed.quantity).toEqual({ type: 'single', value: 2.5 });
    expect(result[0].items[0].parsed.unit).toBe('ml');
    expect(result[0].items[0].parsed.displayText).toBe('½ tsp');
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
              unit: null,
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

// ─── displayText threading ────────────────────────────────────────────────────

describe('parseRecipeIngredients — displayText threading', () => {
  it('threads metric quantity/unit and displayText through to the parsed field', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '½ cup butter, melted',
              quantity: { type: 'single', value: 113 },
              unit: 'g',
              item: 'butter',
              preparation: ['melted'],
              displayText: '½ cup',
            }),
            simpleIngredient({
              rawText: '1 tbsp olive oil',
              quantity: { type: 'single', value: 15 },
              unit: 'ml',
              item: 'olive oil',
              displayText: '1 tbsp',
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({
      rawText: '½ cup butter, melted\n1 tbsp olive oil',
    });

    expect(result[0].items[0].parsed.quantity).toEqual({ type: 'single', value: 113 });
    expect(result[0].items[0].parsed.unit).toBe('g');
    expect(result[0].items[0].parsed.displayText).toBe('½ cup');
    expect(result[0].items[1].parsed.quantity).toEqual({ type: 'single', value: 15 });
    expect(result[0].items[1].parsed.unit).toBe('ml');
    expect(result[0].items[1].parsed.displayText).toBe('1 tbsp');
  });

  it('threads metric weight, "g" unit, and a count displayText for count/item-based ingredients', async () => {
    // Count items are now converted to estimated metric weight by the model; the original
    // count form rides along in displayText. The flow threads whatever the model returns.
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: '2 cloves garlic',
              quantity: { type: 'single', value: 6 },
              unit: 'g',
              item: 'garlic',
              displayText: '2 cloves',
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({ rawText: '2 cloves garlic' });

    expect(result[0].items[0].parsed.quantity).toEqual({ type: 'single', value: 6 });
    expect(result[0].items[0].parsed.unit).toBe('g');
    expect(result[0].items[0].parsed.displayText).toBe('2 cloves');
  });

  it('keeps quantity and unit null for genuinely unquantifiable items', async () => {
    mockGenerate.mockResolvedValue({
      output: aiOutput([
        {
          name: null,
          items: [
            simpleIngredient({
              rawText: 'salt to taste',
              quantity: null,
              unit: null,
              item: 'salt',
              displayText: null,
            }),
          ],
        },
      ]),
    });

    const result = await (parseRecipeIngredientsFlow as Function)({ rawText: 'salt to taste' });

    expect(result[0].items[0].parsed.quantity).toBeNull();
    expect(result[0].items[0].parsed.unit).toBeNull();
    expect(result[0].items[0].parsed.displayText).toBeNull();
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

  it('mandates converting count/pack ingredients to metric in the system prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput([{ name: null, items: [] }]) });

    await (parseRecipeIngredientsFlow as Function)({ rawText: '2 cloves garlic' });

    const { system } = mockGenerate.mock.calls[0]![0];
    // New always-metric mandate: count/pack ingredients are converted, not left unit:null.
    expect(system).toContain('EVERY quantified ingredient must be converted to metric');
    expect(system).toContain('1 clove garlic ≈ 3g');
    // unit:null is now reserved for genuinely unquantifiable items only.
    expect(system).toContain('genuinely unquantifiable');
  });
});
