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

const baseReq = {
  normalisedName: 'tomato',
  candidates: [{ item: { id: 'abc', name: 'Tomato' }, confidence: 0.92 }],
  aisles: [{ id: 'produce-1', name: 'Produce' }],
};

describe('arbitrateCanon flow — output shapes', () => {
  it('returns match result with core fields from ai.generate output', async () => {
    const output = { kind: 'match', itemId: 'abc', confidence: 0.92 };
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    expect(result).toMatchObject(output);
    expect(typeof result.prompt).toBe('string');
    expect(typeof result.rawResponse).toBe('string');
  });

  it('returns new result with aisleId', async () => {
    const output = { kind: 'new', canonName: 'Cherry Tomato', aisleId: 'produce-1' };
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)({
      normalisedName: 'cherry tomato',
      candidates: [],
      aisles: [{ id: 'produce-1', name: 'Produce' }],
    });

    expect(result).toMatchObject(output);
    expect(typeof result.prompt).toBe('string');
    expect(typeof result.rawResponse).toBe('string');
  });

  it('returns new result with null aisleId', async () => {
    const output = { kind: 'new', canonName: 'Cherry Tomato', aisleId: null };
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)({
      normalisedName: 'cherry tomato',
      candidates: [],
      aisles: [],
    });

    expect(result).toMatchObject(output);
  });

  it('returns no-match result with prompt and rawResponse', async () => {
    const output = { kind: 'no-match' };
    mockGenerate.mockResolvedValue({ output, text: JSON.stringify(output) });

    const result = await (arbitrateCanonFlow as Function)({
      normalisedName: 'xyzzy',
      candidates: [],
      aisles: [],
    });

    expect(result).toMatchObject(output);
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.rawResponse).toBe(JSON.stringify(output));
  });

  it('uses JSON.stringify(output) as rawResponse when text is absent', async () => {
    const output = { kind: 'no-match' };
    mockGenerate.mockResolvedValue({ output });

    const result = await (arbitrateCanonFlow as Function)({
      normalisedName: 'xyzzy',
      candidates: [],
      aisles: [],
    });

    expect(result.rawResponse).toBe(JSON.stringify(output));
  });

  it('uses text from ai.generate as rawResponse when present', async () => {
    const output = { kind: 'no-match' };
    const rawText = '{"kind":"no-match"}';
    mockGenerate.mockResolvedValue({ output, text: rawText });

    const result = await (arbitrateCanonFlow as Function)({
      normalisedName: 'xyzzy',
      candidates: [],
      aisles: [],
    });

    expect(result.rawResponse).toBe(rawText);
  });
});

describe('arbitrateCanon flow — prompt construction', () => {
  it('passes normalisedName in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: { kind: 'no-match' } });

    await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"tomato"');
  });

  it('lists candidate ids, names, and scores in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: { kind: 'no-match' } });

    await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"abc"');
    expect(prompt).toContain('"Tomato"');
    expect(prompt).toContain('0.920');
  });

  it('lists aisle ids and names in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: { kind: 'no-match' } });

    await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"produce-1"');
    expect(prompt).toContain('"Produce"');
  });

  it('shows (none) for empty candidates', async () => {
    mockGenerate.mockResolvedValue({ output: { kind: 'no-match' } });

    await (arbitrateCanonFlow as Function)({ normalisedName: 'xyz', candidates: [], aisles: [] });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('(none)');
  });

  it('passes temperature 0 and the output schema to generate', async () => {
    mockGenerate.mockResolvedValue({ output: { kind: 'no-match' } });

    await (arbitrateCanonFlow as Function)(baseReq);

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.config).toEqual({ temperature: 0 });
    expect(opts.output?.schema).toBeDefined();
  });

  it('prompt returned in result matches the prompt sent to ai.generate', async () => {
    mockGenerate.mockResolvedValue({ output: { kind: 'no-match' } });

    const result = await (arbitrateCanonFlow as Function)(baseReq);

    const { prompt: sentPrompt } = mockGenerate.mock.calls[0]![0];
    expect(result.prompt).toBe(sentPrompt);
  });
});
