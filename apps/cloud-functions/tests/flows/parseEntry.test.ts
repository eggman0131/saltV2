import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseShoppingListEntry } from '@salt/domain';

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

// ─── The prompt agrees with the deterministic parser ──────────────────────────
//
// Issue #934, finding A3-005. `onShoppingListItemWrite` runs
// `parseShoppingListEntry` FIRST and only reaches this flow when the entry
// `looksCompound` and the parser extracted nothing — so the same entry can be
// handled by either, and the two used to answer differently. The prompt knew only
// leading DIGITS: it missed the word-number cardinals the parser reads, had no
// rule at all for a trailing quantity, and its own worked example ("8 rashers of
// bacon" → unit "rashers") contradicted what the parser actually returns.
//
// This is the guard, and it is deliberately NOT a substring check on prose. Each
// row states what the prompt now TELLS the model to produce for an entry, and the
// row is checked against what the deterministic parser really produces for that
// same entry. Two things therefore go red: the parser changing behaviour, and a
// prompt example being wrong about it. A hand-written expectation could only
// catch the first — and a hand-written expectation being wrong is what created
// this finding.
//
// The honest boundary: this proves the two AGREE on the cases the prompt
// illustrates. It cannot prove a model obeys the prompt, and it cannot enumerate
// every entry a person might type — a cloud session has no AI keys, and the
// deterministic parser is the only executable half of the pair.
describe('parseEntry prompt — agrees with parseShoppingListEntry', () => {
  // Every worked example the prompt states, as {entry, what the prompt claims}.
  const WORKED_EXAMPLES: {
    entry: string;
    name: string;
    amount?: number;
    unit?: string;
    context?: string;
  }[] = [
    // Rule 3a — written cardinals, which never yield a unit.
    { entry: 'two onions', name: 'onions', amount: 2 },
    { entry: 'a couple of onions', name: 'couple of onions', amount: 1 },
    { entry: 'three bags of flour', name: 'bags of flour', amount: 3 },
    // Rule 3b — number attached to letters.
    { entry: '2kg maris piper potatoes', name: 'maris piper potatoes', amount: 2, unit: 'kg' },
    // Rule 3c — number, space, then a recognised unit or a bare count.
    { entry: '1 packet of ginger biscuits', name: 'ginger biscuits', amount: 1, unit: 'packet' },
    { entry: '3 onions', name: 'onions', amount: 3 },
    { entry: '8 rashers of bacon', name: 'rashers of bacon', amount: 8 },
    // Rule 3d — price notation is not a quantity.
    { entry: '4 for £1', name: '4 for £1' },
    // Rule 4 — trailing quantities, which the prompt had no rule for at all.
    { entry: 'cucumber 400g', name: 'cucumber', amount: 400, unit: 'g' },
    { entry: 'potatoes 1 kg', name: 'potatoes', amount: 1, unit: 'kg' },
    { entry: 'onions 3', name: 'onions', amount: 3 },
    // Rule 5 — a variety adjective is not a unit.
    { entry: '2 red onions', name: 'red onions', amount: 2 },
    // Rule 1 — and the "for" split still wins.
    { entry: 'rice for risotto for friday', name: 'rice', context: 'for risotto for friday' },
  ];

  it.each(WORKED_EXAMPLES)(
    'the deterministic parser produces what the prompt claims for "$entry"',
    ({ entry, name, amount, unit, context }) => {
      expect(parseShoppingListEntry(entry)).toEqual({
        name,
        context: context ?? '',
        ...(amount !== undefined ? { amount } : {}),
        ...(unit !== undefined ? { unit } : {}),
      });
    },
  );

  it('states each of those examples in the prompt the model is actually sent', async () => {
    // The other half: a row above could be correct about the parser and absent
    // from the prompt, which would leave the model still guessing. Checked against
    // the composed prompt, so deleting a rule from `buildPrompt` fails here.
    mockGenerate.mockResolvedValue({ output: { name: 'flour', context: '' } });
    await (parseEntryFlow as Function)({ rawText: 'flour' });
    const { prompt } = mockGenerate.mock.calls[0]![0] as { prompt: string };

    for (const { entry } of WORKED_EXAMPLES) {
      expect(prompt).toContain(`"${entry}"`);
    }
    expect(prompt).toContain('recognised unit');
    expect(prompt).toContain('ONLY when rule 3 found nothing');
  });
});
