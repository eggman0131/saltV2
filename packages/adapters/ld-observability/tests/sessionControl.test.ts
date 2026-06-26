import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();
const mockAddSessionProperties = vi.fn();
const mockGetRecordingState = vi.fn().mockReturnValue('NotRecording');
const mockClientStart = vi.fn().mockResolvedValue(undefined);
const mockCreateClient = vi.fn().mockReturnValue({ start: mockClientStart });

let SessionReplayConstructorArgs: unknown[] = [];
// Vitest 4: mocks invoked with `new` construct the instance, so a constructor
// mock must be a real constructable (function/class), not an arrow function or
// `mockReturnValue`. Use the `function` keyword and return the instance shape.
const MockSessionReplay = vi.fn(function (...args: unknown[]) {
  SessionReplayConstructorArgs = args;
  return {};
});

vi.mock('@launchdarkly/js-client-sdk', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@launchdarkly/observability', () => ({
  // Constructed via `new Observability()` — must be constructable under Vitest 4.
  default: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@launchdarkly/session-replay', () => ({
  default: MockSessionReplay,
  LDRecord: {
    start: mockStart,
    stop: mockStop,
    addSessionProperties: mockAddSessionProperties,
    getRecordingState: mockGetRecordingState,
  },
}));

// Import after mocks are registered
const { initLDObservability } = await import('../src/init.js');
const { startObservabilitySession, stopObservabilitySession, isObservabilitySessionActive } =
  await import('../src/sessionControl.js');

describe('manualStart option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SessionReplayConstructorArgs = [];
    // Reset the module-level client so initLDObservability runs on each test
    vi.resetModules();
  });

  it('passes manualStart: true to SessionReplay when option is set', async () => {
    const { initLDObservability: init } = await import('../src/init.js');
    init('test-key', { manualStart: true });
    expect(MockSessionReplay).toHaveBeenCalledWith({ privacySetting: 'none', manualStart: true });
  });

  it('does not pass manualStart when no option is provided', async () => {
    const { initLDObservability: init } = await import('../src/init.js');
    init('test-key-2');
    expect(MockSessionReplay).toHaveBeenCalledWith({ privacySetting: 'none' });
  });
});

describe('startObservabilitySession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The session controls now stay inert until the LD client is initialised
    // (the e2e LD-gate fix); init the shared module so delegation is exercised.
    initLDObservability('test-key');
  });

  it('calls LDRecord.start with forceNew', async () => {
    await startObservabilitySession();
    expect(mockStart).toHaveBeenCalledWith({ forceNew: true });
  });

  it('tags session with name and timestamp when name is provided', async () => {
    await startObservabilitySession('my-repro');
    expect(mockAddSessionProperties).toHaveBeenCalledWith(
      expect.objectContaining({
        devSessionName: 'my-repro',
        devSessionStartedAt: expect.any(String),
      }),
    );
    expect(mockStart).toHaveBeenCalledWith({ forceNew: true });
  });

  it('does not call addSessionProperties when no name is provided', async () => {
    await startObservabilitySession();
    expect(mockAddSessionProperties).not.toHaveBeenCalled();
  });
});

describe('stopObservabilitySession', () => {
  beforeEach(() => {
    initLDObservability('test-key');
  });

  it('calls LDRecord.stop', () => {
    stopObservabilitySession();
    expect(mockStop).toHaveBeenCalled();
  });
});

describe('isObservabilitySessionActive', () => {
  beforeEach(() => {
    initLDObservability('test-key');
  });

  it('returns true when recording state is Recording', () => {
    mockGetRecordingState.mockReturnValue('Recording');
    expect(isObservabilitySessionActive()).toBe(true);
  });

  it('returns false when recording state is NotRecording', () => {
    mockGetRecordingState.mockReturnValue('NotRecording');
    expect(isObservabilitySessionActive()).toBe(false);
  });
});

// Regression for the e2e LD-gate: when LD is gated off (initLDObservability never
// called), LDRecord is unwired and calling it throws. The session controls must
// stay inert rather than throw, so a gated-off build doesn't break user flows.
describe('uninitialised (LD gated off) — session controls stay inert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('no-ops every entrypoint and never touches LDRecord', async () => {
    const session = await import('../src/sessionControl.js');

    expect(() => session.startObservabilitySession('repro')).not.toThrow();
    expect(() => session.stopObservabilitySession()).not.toThrow();
    expect(session.isObservabilitySessionActive()).toBe(false);

    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockAddSessionProperties).not.toHaveBeenCalled();
    expect(mockGetRecordingState).not.toHaveBeenCalled();
  });
});
