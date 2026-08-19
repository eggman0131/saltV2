import { describe, it, expect, vi, beforeEach } from 'vitest';

// Issue #854. `buildPrompt` is private, so the prompt is pinned the way every
// other flow here pins one: mock genkit, call the flow, read the prompt off the
// generate call. Only the matcher-QUALITY bullet is asserted — the classification
// prompt (action vs component vs none) is correct and is not this issue's
// territory.

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

let fakeOn = false;
vi.mock('../../src/ai/fakeModel.js', () => ({ aiFakeEnabled: () => fakeOn }));

const { arbitrateProductFormFlow } = await import('../../src/flows/arbitrateProductForm.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakeOn = false;
  mockGenerate.mockResolvedValue({
    output: {
      modifier_kind: 'none',
      parent_name: null,
      parent_id: null,
      matcher: null,
      label: null,
      form_unit: null,
      amount_per_parent: null,
      reasoning: 'test',
    },
  });
});

describe('arbitrateProductForm — matcher quality (issue #854)', () => {
  it('requires the matcher to name the parent, never a bare component word', async () => {
    await (arbitrateProductFormFlow as Function)({
      ingredientName: 'lime juice',
      candidates: [],
    });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    // A bare generic matcher is the wart this bullet exists to stop being
    // re-minted: "juice" token-matches every other fruit's juice, so orange
    // juice would resolve to Lime.
    expect(prompt).toContain('The matcher MUST name the parent as well as the component');
    expect(prompt).toContain('"lime juice", never "juice"');
    expect(prompt).toContain('"lemon zest", never "zest"');
    expect(prompt).toContain('"egg yolk", never "yolk"');
    // Consistent with the example the `matcher` field already gives.
    expect(prompt).toContain(
      '- matcher: the lowercase phrase identifying this form in an ingredient name, e.g. "lime juice"',
    );
  });

  it('leaves the component/action classification prompt intact', async () => {
    await (arbitrateProductFormFlow as Function)({
      ingredientName: 'melted butter',
      candidates: [],
    });

    const { prompt } = mockGenerate.mock.calls[0]![0];
    expect(prompt).toContain('## The test — classify the modifier (set modifier_kind)');
    expect(prompt).toContain('modifier_kind="action"');
    expect(prompt).toContain('modifier_kind="component"');
    expect(prompt).toContain('one lime ≈ 30 ml juice');
  });
});
