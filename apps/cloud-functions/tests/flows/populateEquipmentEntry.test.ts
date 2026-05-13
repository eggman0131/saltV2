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
const { populateEquipmentEntryFlow } = await import('../../src/flows/populateEquipmentEntry.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function aiOutput(name: string, accessories: { name: string; included: boolean }[] = []) {
  return { name, accessories };
}

// ─── Result mapping ───────────────────────────────────────────────────────────

describe('populateEquipmentEntry flow — result mapping', () => {
  it('returns the canonical name and accessories from AI output', async () => {
    const accessories = [
      { name: 'Dough hook', included: true },
      { name: 'Pasta roller attachment', included: false },
    ];
    mockGenerate.mockResolvedValue({ output: aiOutput('Stand mixer', accessories) });

    const result = await (populateEquipmentEntryFlow as Function)({
      confirmedName: 'KitchenAid stand mixer',
    });

    expect(result.name).toBe('Stand mixer');
    expect(result.accessories).toEqual(accessories);
  });

  it('returns an empty accessories array when AI returns none', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput('Wooden chopping board') });

    const result = await (populateEquipmentEntryFlow as Function)({
      confirmedName: 'chopping board',
    });

    expect(result.accessories).toEqual([]);
  });

  it('preserves included:true for in-box accessories', async () => {
    const accessories = [{ name: 'Flat beater', included: true }];
    mockGenerate.mockResolvedValue({ output: aiOutput('Stand mixer', accessories) });

    const result = await (populateEquipmentEntryFlow as Function)({
      confirmedName: 'stand mixer',
    });

    expect(result.accessories[0]!.included).toBe(true);
  });

  it('preserves included:false for optional accessories', async () => {
    const accessories = [{ name: 'Ice cream bowl', included: false }];
    mockGenerate.mockResolvedValue({ output: aiOutput('Stand mixer', accessories) });

    const result = await (populateEquipmentEntryFlow as Function)({
      confirmedName: 'stand mixer',
    });

    expect(result.accessories[0]!.included).toBe(false);
  });

  it('returns the canonical name from AI even if it differs from confirmedName', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput('Food processor', []) });

    const result = await (populateEquipmentEntryFlow as Function)({
      confirmedName: 'food processer',
    });

    expect(result.name).toBe('Food processor');
  });

  it('preserves all accessory names unchanged', async () => {
    const accessories = [
      { name: 'Bowl scraper', included: true },
      { name: 'Spiraliser attachment', included: false },
    ];
    mockGenerate.mockResolvedValue({ output: aiOutput('Stand mixer', accessories) });

    const result = await (populateEquipmentEntryFlow as Function)({
      confirmedName: 'stand mixer',
    });

    expect(result.accessories.map((a: { name: string }) => a.name)).toEqual([
      'Bowl scraper',
      'Spiraliser attachment',
    ]);
  });
});

// ─── Prompt construction ──────────────────────────────────────────────────────

describe('populateEquipmentEntry flow — prompt construction', () => {
  it('includes the confirmedName in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput('Thermomix') });

    await (populateEquipmentEntryFlow as Function)({ confirmedName: 'Thermomix TM6' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('"Thermomix TM6"');
  });

  it('passes temperature 0 and the output schema to generate', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput('Blender') });

    await (populateEquipmentEntryFlow as Function)({ confirmedName: 'blender' });

    const opts = mockGenerate.mock.calls[0]![0];
    expect(opts.config).toEqual({ temperature: 0 });
    expect(opts.output?.schema).toBeDefined();
  });

  it('mentions first-party accessories in the prompt', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput('Blender') });

    await (populateEquipmentEntryFlow as Function)({ confirmedName: 'blender' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt.toLowerCase()).toContain('first-party');
  });

  it('instructs the model not to include capabilities or features', async () => {
    mockGenerate.mockResolvedValue({ output: aiOutput('Blender') });

    await (populateEquipmentEntryFlow as Function)({ confirmedName: 'blender' });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt.toLowerCase()).toContain('capabilities');
  });
});
