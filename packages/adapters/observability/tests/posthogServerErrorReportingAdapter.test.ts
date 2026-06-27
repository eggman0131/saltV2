import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DomainError } from '@salt/shared-types';

// Mock posthog-node so initServerObservability builds a fake client and we can
// spy on captureException without a real SDK / network. vi.hoisted keeps the spy
// AND the fake class available to the hoisted vi.mock factory (a top-level class
// would be referenced before initialization inside the hoisted factory).
const { captureException, FakePostHog } = vi.hoisted(() => {
  const captureException = vi.fn();
  // Minimal PostHog stand-in: only the methods the server adapter / init touch.
  class FakePostHog {
    constructor(
      public key: string,
      public opts: unknown,
    ) {}
    captureException(...args: unknown[]): void {
      captureException(...args);
    }
    capture(): void {}
    async flush(): Promise<void> {}
    async shutdown(): Promise<void> {}
  }
  return { captureException, FakePostHog };
});

vi.mock('posthog-node', () => ({
  PostHog: FakePostHog,
}));

import { initServerObservability } from '../src/server/init.js';
import { createPosthogServerErrorReportingAdapter } from '../src/server/posthogServerErrorReportingAdapter.js';

describe('createPosthogServerErrorReportingAdapter', () => {
  beforeEach(() => {
    captureException.mockClear();
    // initServerObservability is idempotent (no-ops if a client already exists),
    // so the first test to run builds the fake client; subsequent calls no-op.
    // A non-empty key flips the package out of its inert state.
    initServerObservability('test-key');
  });

  const reporter = () => createPosthogServerErrorReportingAdapter();

  const reportable: ReadonlyArray<DomainError['kind']> = ['StorageError', 'SyncError', 'AuthError'];
  const suppressed: ReadonlyArray<DomainError['kind']> = [
    'NetworkError',
    'ValidationError',
    'NotFound',
    'ConflictError',
  ];

  it.each(suppressed)('no-ops (does not capture) for suppressed category %s', (kind) => {
    reporter().report(new Error('boom'), kind);
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each(reportable)('captures for reportable category %s', (kind) => {
    reporter().report(new Error('boom'), kind);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('captures when the category is UNDEFINED (raw server exception → reportable)', () => {
    // The dominant server case: a caught exception with no DomainError
    // classification. The widened predicate gates `undefined` as reportable, so
    // the server adapter surfaces it.
    reporter().report(new Error('uncategorised server failure'));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('forwards the raw Error (real stack) and attaches no free-form context', () => {
    const raw = new Error('storage exploded');
    reporter().report(raw, 'StorageError');
    // captureServerException calls captureException(err, SERVER_DISTINCT_ID) — the
    // raw error carries the stack; nothing else (no user content) is attached.
    expect(captureException).toHaveBeenCalledWith(raw, expect.any(String));
  });

  it('wraps a non-Error value so a thrown string still carries a stack', () => {
    reporter().report('plain string failure');
    const [arg] = captureException.mock.calls[0]!;
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toBe('plain string failure');
  });

  it('never throws across the port boundary when the SDK throws (Rule 10)', () => {
    captureException.mockImplementationOnce(() => {
      throw new Error('posthog SDK exploded');
    });
    // safePosthog swallows the SDK failure — report() must return normally.
    expect(() => reporter().report(new Error('boom'), 'StorageError')).not.toThrow();
  });
});
