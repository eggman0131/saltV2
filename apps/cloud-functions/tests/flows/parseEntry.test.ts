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

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks so defineFlow returns the handler directly.
const { parseEntryFlow } = await import('../../src/flows/parseEntry.js');
const { createServerEntryParseAdapter } = await import('../../src/adapters/serverEntryParse.js');

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Flow — result mapping ────────────────────────────────────────────────────

describe('parseEntry flow — result mapping', () => {
  it('returns name and context when AI splits a for-phrase entry', async () => {
    mockGenerate.mockResolvedValue({ output: { name: 'birthday card', context: 'for bob' } });

    const result = await (parseEntryFlow as Function)({ rawText: 'birthday card for bob' });

    expect(result.name).toBe('birthday card');
    expect(result.context).toBe('for bob');
  });

  it('returns full entry as name with empty context when no for-phrase', async () => {
    mockGenerate.mockResolvedValue({ output: { name: 'milk', context: '' } });

    const result = await (parseEntryFlow as Function)({ rawText: 'milk' });

    expect(result.name).toBe('milk');
    expect(result.context).toBe('');
  });

  it('first standalone for wins (non-greedy name capture)', async () => {
    mockGenerate.mockResolvedValue({
      output: { name: 'rice', context: 'for risotto for friday' },
    });

    const result = await (parseEntryFlow as Function)({ rawText: 'rice for risotto for friday' });

    expect(result.name).toBe('rice');
    expect(result.context).toBe('for risotto for friday');
  });

  it('preserves original casing in name and context', async () => {
    mockGenerate.mockResolvedValue({ output: { name: 'Birthday Card', context: 'For Bob' } });

    const result = await (parseEntryFlow as Function)({ rawText: 'Birthday Card For Bob' });

    expect(result.name).toBe('Birthday Card');
    expect(result.context).toBe('For Bob');
  });
});

// ─── Flow — prompt construction ───────────────────────────────────────────────

describe('parseEntry flow — prompt construction', () => {
  it('includes rawText in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: { name: 'birthday card', context: 'for bob' } });

    await (parseEntryFlow as Function)({ rawText: 'birthday card for bob' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"birthday card for bob"');
  });

  it('passes temperature 0 and an output schema to generate', async () => {
    mockGenerate.mockResolvedValue({ output: { name: 'milk', context: '' } });

    await (parseEntryFlow as Function)({ rawText: 'milk' });

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.config).toEqual({ temperature: 0 });
    expect(opts.output?.schema).toBeDefined();
  });
});

// ─── Adapter — ok and error paths ────────────────────────────────────────────

describe('createServerEntryParseAdapter', () => {
  it('returns success with ParsedEntry on ok path', async () => {
    mockGenerate.mockResolvedValue({ output: { name: 'birthday card', context: 'for bob' } });

    const adapter = createServerEntryParseAdapter();
    const result = await adapter.parse('birthday card for bob');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.name).toBe('birthday card');
      expect(result.value.context).toBe('for bob');
    }
  });

  it('returns failure with NetworkError when the flow throws', async () => {
    mockGenerate.mockRejectedValue(new Error('AI unavailable'));

    const adapter = createServerEntryParseAdapter();
    const result = await adapter.parse('birthday card for bob');

    expect(result.kind).toBe('err');
    if (result.kind === 'err') {
      expect(result.error.kind).toBe('NetworkError');
    }
  });

  it('does not throw on AI error — returns failure instead', async () => {
    mockGenerate.mockRejectedValue(new Error('network timeout'));

    const adapter = createServerEntryParseAdapter();

    await expect(adapter.parse('anything')).resolves.toMatchObject({ kind: 'err' });
  });

  it('threads amount and unit through when the AI returns them', async () => {
    mockGenerate.mockResolvedValue({
      output: { name: 'maris piper potatoes', context: '', amount: 2, unit: 'kg' },
    });

    const adapter = createServerEntryParseAdapter();
    const result = await adapter.parse('2kg maris piper potatoes');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.amount).toBe(2);
      expect(result.value.unit).toBe('kg');
      expect(result.value.name).toBe('maris piper potatoes');
    }
  });

  it('omits amount and unit when the AI does not return them', async () => {
    mockGenerate.mockResolvedValue({ output: { name: 'milk', context: '' } });

    const adapter = createServerEntryParseAdapter();
    const result = await adapter.parse('milk');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.amount).toBeUndefined();
      expect(result.value.unit).toBeUndefined();
    }
  });
});

// ─── Flow — amount/unit in prompt and output ──────────────────────────────────

describe('parseEntry flow — amount/unit', () => {
  it('passes amount and unit through when AI returns them', async () => {
    mockGenerate.mockResolvedValue({
      output: { name: 'maris piper potatoes', context: '', amount: 2, unit: 'kg' },
    });

    const result = await (parseEntryFlow as Function)({ rawText: '2kg maris piper potatoes' });

    expect(result.amount).toBe(2);
    expect(result.unit).toBe('kg');
    expect(result.name).toBe('maris piper potatoes');
  });

  it('prompt instructs the model to extract a leading quantity', async () => {
    mockGenerate.mockResolvedValue({
      output: { name: 'flour', context: '', amount: 2, unit: 'kg' },
    });

    await (parseEntryFlow as Function)({ rawText: '2kg flour' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('amount');
    expect(prompt).toContain('unit');
  });
});
