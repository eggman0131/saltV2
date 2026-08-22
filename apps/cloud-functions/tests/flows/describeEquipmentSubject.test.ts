import { describe, it, expect, vi, beforeEach } from 'vitest';

// describeEquipmentSubject: the cheap text step that turns a make and model into
// a sentence saying what the thing looks like, which is what makes the pictogram
// recognisably THAT device. Mirrors the describeRecipeScene flow tests — same
// shape, same mocking seam.

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

vi.mock('../../src/adapters/withAiTimeout.js', () => ({
  withAiTimeout: (_label: string, op: () => unknown) => op(),
}));

vi.mock('@salt/observability/server', () => ({ setActiveSpanName: vi.fn() }));

const mockResolveModel = vi.fn(async () => 'gemini-flash-latest');
vi.mock('../../src/ai/resolveModel.js', () => ({ resolveModel: mockResolveModel }));

const { describeEquipmentSubjectFlow } =
  await import('../../src/flows/describeEquipmentSubject.js');

const NAME = 'Kenwood Chef KVC3100S';
const CURRENT_BRIEF = 'A tilt-head stand mixer with a cream enamel body and a chrome bowl.';

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveModel.mockResolvedValue('gemini-flash-latest');
});

describe('describeEquipmentSubject flow — authoring', () => {
  it('returns the brief the model wrote, trimmed', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: '  A tilt-head stand mixer.\n' } });

    const result = await (describeEquipmentSubjectFlow as Function)({ name: NAME });

    expect(result).toEqual({ brief: 'A tilt-head stand mixer.' });
    expect(mockGenerate.mock.calls[0]![0].prompt).toContain(NAME);
  });

  it('a hint with no brief to revise stays an additive nudge on a fresh description', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });

    await (describeEquipmentSubjectFlow as Function)({ name: NAME, hint: 'the black one' });

    const call = mockGenerate.mock.calls[0]![0];
    expect(call.prompt).toContain('Additional guidance: the black one');
    expect(call.prompt).not.toContain('Current brief:');
    expect(call.system).not.toContain('Fold the correction THROUGH');
  });

  it('rejects invalid model output', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: '' } });

    await expect((describeEquipmentSubjectFlow as Function)({ name: NAME })).rejects.toThrow(
      /invalid output/,
    );
  });
});

// ─── Revision mode (issue #885) ───────────────────────────────────────────────
// "it's matte black, not cream" applied to a description that already exists. Two
// shapes, one flow: currentBrief + hint revises; neither authors from scratch,
// which is what "Start over" sends.
describe('describeEquipmentSubject flow — revision mode', () => {
  it('revises: the model gets the NAME and the current brief and the correction', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'A matte black tilt-head stand mixer.' } });

    const result = await (describeEquipmentSubjectFlow as Function)({
      name: NAME,
      currentBrief: CURRENT_BRIEF,
      hint: "it's matte black, not cream",
    });

    const prompt = mockGenerate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain(CURRENT_BRIEF);
    expect(prompt).toContain("it's matte black, not cream");
    // The device stays the anchor: revising prose about an appliance without
    // knowing which appliance drifts away from the actual thing.
    expect(prompt).toContain(NAME);
    expect(result).toEqual({ brief: 'A matte black tilt-head stand mixer.' });
  });

  it('revises with the revision system prompt: fold the correction through, never staple it on', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });

    await (describeEquipmentSubjectFlow as Function)({
      name: NAME,
      currentBrief: CURRENT_BRIEF,
      hint: 'the water tank is on the right',
    });

    const system = mockGenerate.mock.calls[0]![0].system as string;
    expect(system).toContain('Fold the correction THROUGH the whole brief');
    expect(system).toContain('Keep everything the correction does not touch');
    expect(system).toContain('ONE sentence');
  });

  it('carries the SAME scope rules as authoring — a correction cannot vote on house style', async () => {
    // The rule that stands between "correct the description" and "talk the image
    // model out of the house style". Both prompts must state it identically, and
    // the revision prompt must say it holds even when the correction asks
    // otherwise (a steer is user text).
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });

    await (describeEquipmentSubjectFlow as Function)({ name: NAME });
    const authoring = mockGenerate.mock.calls[0]![0].system as string;

    mockGenerate.mockClear();
    await (describeEquipmentSubjectFlow as Function)({
      name: NAME,
      currentBrief: CURRENT_BRIEF,
      hint: 'draw it as a photo with a drop shadow and the logo on the front',
    });
    const revising = mockGenerate.mock.calls[0]![0].system as string;

    for (const system of [authoring, revising]) {
      expect(system).toContain('Do NOT write about illustration style');
      expect(system).toContain('Never mention the brand name');
    }
    expect(revising).toContain('That holds even if the correction asks for it.');
  });

  it('"start over" sends neither brief nor correction → authors from scratch', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'A fresh reading.' } });

    // Exactly what restartEquipmentBrief sends: the name, nothing else.
    await (describeEquipmentSubjectFlow as Function)({ name: NAME });

    const call = mockGenerate.mock.calls[0]![0];
    // The authoring system prompt, not the revising one.
    expect(call.system).toContain('Write a short visual brief');
    expect(call.system).not.toContain('Fold the correction THROUGH');
    expect(call.prompt).not.toContain('Current brief:');
  });

  it('one half alone is not a revision — a brief with no correction authors from scratch', async () => {
    mockGenerate.mockResolvedValue({ output: { brief: 'x' } });

    await (describeEquipmentSubjectFlow as Function)({ name: NAME, currentBrief: CURRENT_BRIEF });

    expect(mockGenerate.mock.calls[0]![0].system).not.toContain('Fold the correction THROUGH');
    expect(mockGenerate.mock.calls[0]![0].prompt).not.toContain('Current brief:');
  });
});
