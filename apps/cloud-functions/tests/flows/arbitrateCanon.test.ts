import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerate = vi.fn();

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));

vi.mock('@genkit-ai/google-genai', () => ({
  googleAI: {
    model: (name: string) => name,
  },
}));

// Import after mocks so defineFlow returns the handler directly.
const { arbitrateCanonFlow } = await import('../../src/flows/arbitrateCanon.js');

beforeEach(() => {
  vi.clearAllMocks();
});

// Flat AI output shape returned by the model.
function aiOutput(
  overrides: Partial<{
    match_found: boolean;
    match_id: string | null;
    canonical_name: string | null;
    aisle_name: string | null;
    shoppingBehavior: 'stocked' | 'check' | 'needed';
    largeQuantityThreshold: number | null;
    unit: 'g' | 'ml' | 'count' | null;
    reasoning: string;
  }> = {},
) {
  return {
    match_found: false,
    match_id: null,
    canonical_name: null,
    aisle_name: null,
    shoppingBehavior: 'needed' as const,
    largeQuantityThreshold: null,
    unit: null,
    reasoning: 'test reasoning',
    ...overrides,
  };
}

const baseReq = {
  normalisedName: 'tomato',
  candidates: [{ item: { id: 'abc', name: 'Tomato' }, confidence: 0.92 }],
  aisles: [{ id: 'produce-1', name: 'Produce' }],
};

// ─── Result mapping ───────────────────────────────────────────────────────────

describe('arbitrateCanon flow — result mapping', () => {
  it('maps match_found=true to kind:match with itemId and confidence from candidates', async () => {
    const output = aiOutput({ match_found: true, match_id: 'abc', shoppingBehavior: 'check' });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.kind).toBe('match');
    expect(result.itemId).toBe('abc');
    expect(result.confidence).toBe(0.92);
    expect(result.shoppingBehavior).toBe('check');
    expect(typeof result.prompt).toBe('string');
    expect(typeof result.rawResponse).toBe('string');
  });

  it('uses confidence from the candidates list for the matched id', async () => {
    const req = {
      normalisedName: 'tomato',
      candidates: [
        { item: { id: 'abc', name: 'Tomato' }, confidence: 0.85 },
        { item: { id: 'xyz', name: 'Plum Tomato' }, confidence: 0.72 },
      ],
      aisles: [],
    };
    const output = aiOutput({ match_found: true, match_id: 'xyz' });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(req);

    expect(result.confidence).toBe(0.72);
  });

  it('falls back to confidence 1.0 when match_id is not in the candidates list', async () => {
    const output = aiOutput({ match_found: true, match_id: 'unknown-id' });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.confidence).toBe(1.0);
  });

  it('maps match_found=false with canonical_name to kind:new', async () => {
    const output = aiOutput({
      match_found: false,
      canonical_name: 'Cherry Tomato',
      aisle_name: 'Produce',
      shoppingBehavior: 'needed',
    });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.kind).toBe('new');
    expect(result.canonName).toBe('Cherry Tomato');
    expect(result.aisleId).toBe('produce-1');
    expect(result.shoppingBehavior).toBe('needed');
  });

  it('maps aisle_name to aisleId via the live aisle list (first match wins)', async () => {
    const req = {
      normalisedName: 'butter',
      candidates: [],
      aisles: [
        { id: 'dairy-1', name: 'Dairy' },
        { id: 'dairy-2', name: 'Dairy' },
      ],
    };
    const output = aiOutput({ canonical_name: 'Butter', aisle_name: 'Dairy' });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(req);

    expect(result.kind).toBe('new');
    expect(result.aisleId).toBe('dairy-1');
  });

  it('sets aisleId to null when aisle_name is not in the live list', async () => {
    const output = aiOutput({
      canonical_name: 'Exotic Fruit',
      aisle_name: 'World Foods',
    });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.kind).toBe('new');
    expect(result.aisleId).toBeNull();
  });

  it('sets aisleId to null when aisle_name is null', async () => {
    const output = aiOutput({ canonical_name: 'Cherry Tomato', aisle_name: null });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.kind).toBe('new');
    expect(result.aisleId).toBeNull();
  });

  it('maps match_found=false with null canonical_name to kind:no-match', async () => {
    const output = aiOutput({ match_found: false, canonical_name: null });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.kind).toBe('no-match');
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it('passes largeQuantityThreshold and unit through on new result', async () => {
    const output = aiOutput({
      canonical_name: 'Plain Flour',
      aisle_name: 'Produce',
      shoppingBehavior: 'stocked',
      largeQuantityThreshold: 1000,
      unit: 'g',
    });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.kind).toBe('new');
    expect(result.largeQuantityThreshold).toBe(1000);
    expect(result.unit).toBe('g');
  });

  it('omits largeQuantityThreshold and unit when null', async () => {
    const output = aiOutput({
      canonical_name: 'Tomato',
      largeQuantityThreshold: null,
      unit: null,
    });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.largeQuantityThreshold).toBeUndefined();
    expect(result.unit).toBeUndefined();
  });

  it('includes reasoning on match and new results', async () => {
    const output = aiOutput({
      canonical_name: 'Cherry Tomato',
      reasoning: 'Small round tomatoes sold in UK supermarkets as cherry tomatoes.',
    });
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.reasoning).toBe(
      'Small round tomatoes sold in UK supermarkets as cherry tomatoes.',
    );
  });
});

// ─── rawResponse handling ─────────────────────────────────────────────────────

describe('arbitrateCanon flow — rawResponse', () => {
  it('uses text from ai.generate as rawResponse when present', async () => {
    const output = aiOutput({ canonical_name: 'Tomato' });
    const rawText = '{"match_found":false,"canonical_name":"Tomato"}';
    mockGenerate.mockResolvedValue({ output, text: rawText });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.rawResponse).toBe(rawText);
  });

  it('uses JSON.stringify(output) as rawResponse when text is absent', async () => {
    const output = aiOutput({ canonical_name: null });
    mockGenerate.mockResolvedValue({ output });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result.rawResponse).toBe(JSON.stringify(output));
  });
});

// ─── Prompt construction ──────────────────────────────────────────────────────

describe('arbitrateCanon flow — prompt construction', () => {
  it('passes normalisedName in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput({ canonical_name: null }) });

    await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"tomato"');
  });

  it('lists candidate ids, names, and scores in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput({ canonical_name: null }) });

    await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"abc"');
    expect(prompt).toContain('"Tomato"');
    expect(prompt).toContain('0.920');
  });

  it('lists aisle names in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput({ canonical_name: null }) });

    await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"Produce"');
  });

  it('shows (none) for empty candidates', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput({ canonical_name: null }) });

    await (arbitrateCanonFlow as Function)({ normalisedName: 'xyz', candidates: [], aisles: [] });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('(none)');
  });

  it('passes temperature 0 and the output schema to generate', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput({ canonical_name: null }) });

    await (arbitrateCanonFlow as Function)(baseReq);

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.config).toEqual({ temperature: 0 });
    expect(opts.output?.schema).toBeDefined();
  });

  it('prompt returned in result matches the prompt sent to ai.generate', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput({ canonical_name: null }) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt: sentPrompt } = mockGenerate.mock.calls[0]![0];
    expect(result.prompt).toBe(sentPrompt);
  });
});
