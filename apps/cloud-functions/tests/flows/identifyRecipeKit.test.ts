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

// Stub withAiTimeout to call op() directly — timeout/retry logic is tested elsewhere.
// Bypass the real timer, but keep everything else the module exports (the
// shared budget constant, the stream guard) — a factory that lists only
// `withAiTimeout` goes stale the moment the module grows.
vi.mock('../../src/adapters/withAiTimeout.js', async (importActual) => ({
  ...(await importActual<object>()),
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));

// resolveModel reads Firestore in production; pin it in the unit test.
vi.mock('../../src/ai/resolveModel.js', () => ({
  resolveModel: vi.fn().mockResolvedValue('gemini-flash-latest'),
}));

const { identifyRecipeKitFlow, sanitiseRecipeKit } =
  await import('../../src/flows/identifyRecipeKit.js');

beforeEach(() => {
  vi.clearAllMocks();
});

const input = {
  title: 'Champ',
  description: 'Buttery mashed potato with spring onions.',
  ingredients: ['1kg floury potatoes', '100g butter'],
  steps: [
    { id: 's1', text: 'Boil the potatoes until tender.' },
    { id: 's2', text: 'Drain, then mash with the butter.' },
  ],
};

describe('sanitiseRecipeKit', () => {
  it('drops a step id that is not a step on this recipe', () => {
    const kit = sanitiseRecipeKit(
      [{ label: 'potato masher', stepIds: ['s2', 's99'] }],
      ['s1', 's2'],
    );
    expect(kit).toEqual([{ label: 'potato masher', stepIds: ['s2'] }]);
  });

  it('keeps an entry whose step ids were all hallucinated', () => {
    // A piece of kit with no step attached is still real kit — a mixing bowl the
    // method never mentions — so an emptied `stepIds` must not drop the entry.
    const kit = sanitiseRecipeKit([{ label: 'large mixing bowl', stepIds: ['nope'] }], ['s1']);
    expect(kit).toEqual([{ label: 'large mixing bowl', stepIds: [] }]);
  });

  it('drops an entry with a blank or whitespace-only label', () => {
    const kit = sanitiseRecipeKit(
      [
        { label: '', stepIds: ['s1'] },
        { label: '   ', stepIds: ['s1'] },
        { label: 'colander', stepIds: ['s1'] },
      ],
      ['s1'],
    );
    expect(kit).toEqual([{ label: 'colander', stepIds: ['s1'] }]);
  });

  it('collapses duplicate labels, keeping the first spelling and merging the steps', () => {
    const kit = sanitiseRecipeKit(
      [
        { label: 'Large saucepan', stepIds: ['s1'] },
        { label: '  large   saucepan ', stepIds: ['s2'] },
      ],
      ['s1', 's2'],
    );
    expect(kit).toEqual([{ label: 'Large saucepan', stepIds: ['s1', 's2'] }]);
  });

  it('de-duplicates repeated step ids within one entry', () => {
    const kit = sanitiseRecipeKit([{ label: 'wooden spoon', stepIds: ['s1', 's1'] }], ['s1']);
    expect(kit).toEqual([{ label: 'wooden spoon', stepIds: ['s1'] }]);
  });

  it('preserves the order the model listed the kit in', () => {
    const kit = sanitiseRecipeKit(
      [
        { label: 'large saucepan', stepIds: ['s1'] },
        { label: 'colander', stepIds: ['s2'] },
        { label: 'potato masher', stepIds: ['s2'] },
      ],
      ['s1', 's2'],
    );
    expect(kit.map((k) => k.label)).toEqual(['large saucepan', 'colander', 'potato masher']);
  });

  it('trims the label it keeps', () => {
    expect(sanitiseRecipeKit([{ label: '  box grater ', stepIds: [] }], [])).toEqual([
      { label: 'box grater', stepIds: [] },
    ]);
  });
});

describe('identifyRecipeKit flow', () => {
  it('sanitises the model output against the recipe it was asked about', async () => {
    mockGenerate.mockResolvedValue({
      output: {
        kit: [
          { label: 'large saucepan', stepIds: ['s1', 'not-a-step'] },
          { label: '', stepIds: ['s1'] },
          { label: 'Large saucepan', stepIds: ['s2'] },
        ],
      },
    });

    const result = await (identifyRecipeKitFlow as Function)(input);

    expect(result).toEqual({ kit: [{ label: 'large saucepan', stepIds: ['s1', 's2'] }] });
  });

  it('sends the step ids to the model alongside the step text', async () => {
    mockGenerate.mockResolvedValue({ output: { kit: [] } });

    await (identifyRecipeKitFlow as Function)(input);

    const prompt = mockGenerate.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('[s1] Boil the potatoes until tender.');
    expect(prompt).toContain('[s2] Drain, then mash with the butter.');
  });

  it('throws when the model returns an unparseable shape', async () => {
    mockGenerate.mockResolvedValue({ output: { kit: [{ label: 'pan' }] } });

    await expect((identifyRecipeKitFlow as Function)(input)).rejects.toThrow(
      /identifyRecipeKit returned invalid output/,
    );
  });

  it('does not constrain the model to a vocabulary — an unknown tool passes through', async () => {
    // The load-bearing decision of issue #882: labels are free text, so a tool the
    // drawn vocabulary has never heard of survives to the document and renders as
    // words with no picture. An enum here would have turned it into something else.
    mockGenerate.mockResolvedValue({
      output: { kit: [{ label: 'tagine', stepIds: ['s1'] }] },
    });

    const result = await (identifyRecipeKitFlow as Function)(input);

    expect(result.kit).toEqual([{ label: 'tagine', stepIds: ['s1'] }]);
  });
});
