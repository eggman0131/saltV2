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
const { identifyEquipmentFlow } = await import('../../src/flows/identifyEquipment.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function aiOutput(candidates: { name: string; rationale: string }[] = []) {
  return { candidates };
}

// ─── Result mapping ───────────────────────────────────────────────────────────

describe('identifyEquipment flow — result mapping', () => {
  it('returns candidates from AI output', async () => {
    const candidates = [
      { name: 'Stand mixer', rationale: 'Common interpretation of the input.' },
      { name: 'Food processor', rationale: 'Alternative interpretation.' },
    ];
    mockGenerate.mockResolvedValue({ output: aiOutput(candidates) });

    const result = await (identifyEquipmentFlow as Function)({ rawName: 'KitchenAid' });

    expect(result.candidates).toEqual(candidates);
  });

  it('returns a single candidate when AI returns one', async () => {
    const candidates = [{ name: 'Thermomix', rationale: 'Brand-specific all-in-one cooker.' }];
    mockGenerate.mockResolvedValue({ output: aiOutput(candidates) });

    const result = await (identifyEquipmentFlow as Function)({ rawName: 'Thermomix TM6' });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.name).toBe('Thermomix');
  });

  it('returns an empty candidates array when AI returns none', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput([]) });

    const result = await (identifyEquipmentFlow as Function)({ rawName: 'unknown gadget' });

    expect(result.candidates).toEqual([]);
  });

  it('preserves name and rationale for each candidate', async () => {
    const candidates = [
      { name: 'Hand blender', rationale: 'Matches the description of an immersion blender.' },
    ];
    mockGenerate.mockResolvedValue({ output: aiOutput(candidates) });

    const result = await (identifyEquipmentFlow as Function)({ rawName: 'stick blender' });

    expect(result.candidates[0]!.name).toBe('Hand blender');
    expect(result.candidates[0]!.rationale).toBe(
      'Matches the description of an immersion blender.',
    );
  });
});

// ─── Prompt construction ──────────────────────────────────────────────────────

describe('identifyEquipment flow — prompt construction', () => {
  it('includes the rawName in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput() });

    await (identifyEquipmentFlow as Function)({ rawName: 'Magimix 5200XL' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"Magimix 5200XL"');
  });

  it('passes temperature 0 and the output schema to generate', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput() });

    await (identifyEquipmentFlow as Function)({ rawName: 'blender' });

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.config).toEqual({ temperature: 0 });
    expect(opts.output?.schema).toBeDefined();
  });

  it('mentions UK English in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput() });

    await (identifyEquipmentFlow as Function)({ rawName: 'broiler' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('UK');
  });

  it('instructs the model to collapse cosmetic variants', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput() });

    await (identifyEquipmentFlow as Function)({ rawName: 'anything' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt.toLowerCase()).toContain('cosmetic variant');
  });
});
