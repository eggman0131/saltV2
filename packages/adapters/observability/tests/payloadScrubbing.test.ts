import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Payload scrubbing (Phase 4): no raw user content leaks into the reported
// event payload from EITHER adapter.
//
// Data is family-shared (no per-user PII by design), but free-form user content
// (canon match text, recipe ingredient strings, …) must never be attached as a
// SEPARATE context/properties bag on a reported error (CLAUDE.md §Observability,
// docs/salt-architecture.md §7.6).
//
// IMPORTANT invariant being asserted: the error's own message/stack is the
// SIGNAL and is intentionally KEPT — we do NOT scrub the message. The invariant
// is narrower: no additional free-form context bag carrying user input is
// attached alongside the error. So we embed user text in the MESSAGE and assert
// the adapters add no user-content property — NOT that the message is sanitised.
// ---------------------------------------------------------------------------

const { clientCapture, clientInit, serverCapture, FakePostHog } = vi.hoisted(() => {
  const serverCapture = vi.fn();
  class FakePostHog {
    constructor(
      public key: string,
      public opts: unknown,
    ) {}
    captureException(...args: unknown[]): void {
      serverCapture(...args);
    }
    capture(): void {}
    async flush(): Promise<void> {}
    async shutdown(): Promise<void> {}
  }
  return {
    clientCapture: vi.fn(),
    clientInit: vi.fn(),
    serverCapture,
    FakePostHog,
  };
});

vi.mock('posthog-js', () => ({
  default: {
    init: clientInit,
    captureException: clientCapture,
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('posthog-node', () => ({
  PostHog: FakePostHog,
}));

import { initObservability } from '../src/init.js';
import { initServerObservability } from '../src/server/init.js';
import { createPosthogErrorReportingAdapter } from '../src/posthogErrorReportingAdapter.js';
import { createPosthogServerErrorReportingAdapter } from '../src/server/posthogServerErrorReportingAdapter.js';

// Free-form user content embedded in the error message — the kind of string that
// must NOT be re-attached as a separate property bag.
const USER_TEXT = 'two pounds of organic heirloom tomatoes, finely diced';

describe('error-reporting payload scrubbing (both adapters)', () => {
  beforeEach(() => {
    clientCapture.mockClear();
    serverCapture.mockClear();
    initObservability('test-key');
    initServerObservability('test-key');
  });

  it('client: attaches ONLY error.category, no user-content property bag', () => {
    const error = new Error(`canon match failed: "${USER_TEXT}"`);
    createPosthogErrorReportingAdapter().report(error, 'SyncError');

    expect(clientCapture).toHaveBeenCalledTimes(1);
    const [capturedError, props] = clientCapture.mock.calls[0]!;

    // The raw error (message/stack = the signal) is forwarded verbatim.
    expect(capturedError).toBe(error);

    // The properties bag is EXACTLY the category — no spread, no user-text key.
    expect(Object.keys(props as Record<string, unknown>)).toEqual(['error.category']);
    expect((props as Record<string, unknown>)['error.category']).toBe('SyncError');

    // Defence-in-depth: no property VALUE carries the user text either.
    for (const value of Object.values(props as Record<string, unknown>)) {
      expect(String(value)).not.toContain(USER_TEXT);
    }
  });

  it('server: passes only the distinctId string, no properties bag at all', () => {
    const error = new Error(`recipe ingredient parse failed: "${USER_TEXT}"`);
    createPosthogServerErrorReportingAdapter().report(error, 'StorageError');

    expect(serverCapture).toHaveBeenCalledTimes(1);
    const args = serverCapture.mock.calls[0]!;

    // captureServerException(err, SERVER_DISTINCT_ID): exactly two args, the raw
    // error then a plain distinctId string. No third properties argument.
    expect(args).toHaveLength(2);
    expect(args[0]).toBe(error);
    expect(typeof args[1]).toBe('string');

    // The distinctId is a synthetic server person, NOT user content.
    expect(String(args[1])).not.toContain(USER_TEXT);
  });

  it('server: distinctId is the synthetic server person, never derived from the error', () => {
    // Two different errors with different user text must produce the SAME
    // distinctId — proving the second arg is a fixed synthetic id, not anything
    // computed from the (user-bearing) error.
    createPosthogServerErrorReportingAdapter().report(
      new Error(`first: ${USER_TEXT}`),
      'StorageError',
    );
    createPosthogServerErrorReportingAdapter().report(
      new Error('second: completely different content'),
      'SyncError',
    );

    expect(serverCapture).toHaveBeenCalledTimes(2);
    const [, firstId] = serverCapture.mock.calls[0]!;
    const [, secondId] = serverCapture.mock.calls[1]!;
    expect(firstId).toBe(secondId);
  });
});
