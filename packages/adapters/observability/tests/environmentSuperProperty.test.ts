import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// `environment` flag parity across the two runtimes.
//
//  - Browser (posthog-js): registered as a SUPER PROPERTY at init, so the SDK
//    rides it on every event automatically — one register() call, no per-site
//    plumbing.
//  - Server (posthog-node): has NO register()/super-property concept, so the
//    value is merged into the properties of every capture from the three emit
//    helpers (the single chokepoint server events funnel through).
//
// Both sides use the SAME property name (`environment`) and vocabulary so the
// dimension is consistent across client and CF events in PostHog.
// ---------------------------------------------------------------------------

const {
  register,
  clientCapture,
  clientCaptureException,
  serverCapture,
  serverCaptureException,
  FakePostHog,
} = vi.hoisted(() => {
  const serverCapture = vi.fn();
  const serverCaptureException = vi.fn();
  // Minimal posthog-node stand-in: only the methods init / the captures touch.
  class FakePostHog {
    constructor(
      public key: string,
      public opts: unknown,
    ) {}
    capture(...args: unknown[]): void {
      serverCapture(...args);
    }
    captureException(...args: unknown[]): void {
      serverCaptureException(...args);
    }
    async flush(): Promise<void> {}
    async shutdown(): Promise<void> {}
  }
  return {
    register: vi.fn(),
    clientCapture: vi.fn(),
    clientCaptureException: vi.fn(),
    serverCapture,
    serverCaptureException,
    FakePostHog,
  };
});

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register,
    capture: clientCapture,
    captureException: clientCaptureException,
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('posthog-node', () => ({ PostHog: FakePostHog }));

import { initObservability } from '../src/init.js';
import {
  initServerObservability,
  captureServerEvent,
  captureServerException,
  captureAiGeneration,
} from '../src/server/init.js';

const ENV = 'staging';

type CaptureArg = { event?: string; properties: Record<string, unknown> };

describe('environment flag (super property browser-side, per-event server-side)', () => {
  beforeEach(() => {
    register.mockClear();
    serverCapture.mockClear();
    serverCaptureException.mockClear();
    // Both inits are idempotent — the first call in this (vitest-isolated) test
    // module records the environment; later beforeEach calls no-op.
    initObservability('test-key', { environment: ENV });
    initServerObservability('test-key', ENV);
  });

  it('browser: registers the environment as a PostHog super property at init', () => {
    expect(register).toHaveBeenCalledWith({ environment: ENV });
  });

  it('server: attaches environment to a plain captured event', () => {
    captureServerEvent('canon.match', { 'canon.path': 'cf' });
    const [arg] = serverCapture.mock.calls.at(-1)!;
    expect((arg as CaptureArg).properties).toMatchObject({ 'canon.path': 'cf', environment: ENV });
  });

  it('server: attaches environment to the $ai_generation event', () => {
    captureAiGeneration({ flow: 'parseEntry', model: 'gemini-2.5-flash' });
    const [arg] = serverCapture.mock.calls.at(-1)!;
    expect((arg as CaptureArg).properties).toMatchObject({
      environment: ENV,
      $ai_model: 'gemini-2.5-flash',
    });
  });

  it('server: passes environment as captureException additionalProperties', () => {
    const err = new Error('boom');
    captureServerException(err);
    expect(serverCaptureException).toHaveBeenCalledWith(err, expect.any(String), {
      environment: ENV,
    });
  });

  it('server: an explicit event property of the same name wins over the global', () => {
    // posthog-js semantics: event properties override super properties. The
    // server withEnvironment merge mirrors that (environment spread first).
    captureServerEvent('canon.match', { environment: 'override' });
    const [arg] = serverCapture.mock.calls.at(-1)!;
    expect((arg as CaptureArg).properties.environment).toBe('override');
  });
});
