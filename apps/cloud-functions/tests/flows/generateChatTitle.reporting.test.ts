import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 3: an onCallGenkit flow throwing (incl. AiTimeoutError) must be reported
// to PostHog at the flow boundary it controls, flushed, then re-thrown unchanged
// so Genkit's error path / the flow's success behaviour are untouched.
//
// generateChatTitle is reached ONLY via its onCallGenkit callable, so the flow
// body's try/catch is the single reporting site for it (no double-report risk).

// ─── Spy on the server error reporter + flush ─────────────────────────────────
const mockReport = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

vi.mock('@salt/observability/server', () => ({
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: mockReport })),
  flushServerObservability: mockFlush,
}));

// ─── Mock Genkit so defineFlow returns the handler directly ───────────────────
const mockGenerate = vi.fn();
vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: mockGenerate,
  },
}));

// ─── Mock model resolution + AI-generation telemetry passthrough ──────────────
vi.mock('../../src/ai/fakeModel.js', () => ({
  flowModel: vi.fn(async () => 'fake-model'),
  aiModelLabel: vi.fn(async () => 'fake-model-label'),
}));
// tracedGenerate just invokes the op; its telemetry is out of scope here.
vi.mock('../../src/ai/aiGenerationTelemetry.js', () => ({
  tracedGenerate: vi.fn((_flow: string, _model: string, op: () => unknown) => op()),
}));

// Import after mocks so defineFlow returns the handler directly.
const { generateChatTitleFlow } = await import('../../src/flows/generateChatTitle.js');

const INPUT = { userMessage: 'how do I make pasta', assistantResponse: 'boil water, add pasta' };

beforeEach(() => {
  vi.clearAllMocks();
  mockFlush.mockResolvedValue(undefined);
});

describe('generateChatTitle flow — failure reporting', () => {
  it('reports the AI failure (uncategorised), flushes, and re-throws unchanged', async () => {
    const boom = new Error('generateChatTitle timed out after 15000ms');
    mockGenerate.mockRejectedValue(boom);

    await expect((generateChatTitleFlow as Function)(INPUT)).rejects.toThrow(boom);

    // Uncategorised server exception → reportable (undefined category).
    expect(mockReport).toHaveBeenCalledWith(boom, undefined);
    // Flushed so the event is not stranded when the function freezes.
    expect(mockFlush).toHaveBeenCalled();
  });

  it('does not report on the success path', async () => {
    mockGenerate.mockResolvedValue({ text: 'Pasta Basics' });

    const title = await (generateChatTitleFlow as Function)(INPUT);

    expect(title).toBe('Pasta Basics');
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('does not attach the raw chat text to the report payload', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'));

    await expect(
      (generateChatTitleFlow as Function)({
        userMessage: 'a very specific secret family recipe for lasagne',
        assistantResponse: 'here is the secret',
      }),
    ).rejects.toThrow();

    // report() receives only (error, category) — never the user message.
    const args = mockReport.mock.calls[0]!;
    expect(JSON.stringify(args)).not.toContain('secret family recipe');
  });
});
