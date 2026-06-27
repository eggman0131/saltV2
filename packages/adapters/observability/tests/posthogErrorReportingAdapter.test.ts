import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DomainError } from '@salt/shared-types';

// Mock posthog-js so initObservability flips `ready` true and we can spy on
// captureException without a real SDK / network. vi.hoisted keeps the spies
// available to the hoisted vi.mock factory.
const { captureException, init } = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));
vi.mock('posthog-js', () => ({
  default: {
    init,
    captureException,
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

import { initObservability } from '../src/init.js';
import { createPosthogErrorReportingAdapter } from '../src/posthogErrorReportingAdapter.js';

describe('createPosthogErrorReportingAdapter', () => {
  beforeEach(() => {
    captureException.mockClear();
    init.mockClear();
    // initObservability is idempotent across modules within a run; calling with a
    // key flips the shared `ready` flag so safePosthog actually invokes the SDK.
    initObservability('test-key');
  });

  const reporter = () => createPosthogErrorReportingAdapter();

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

  it('forwards the raw Error (real stack) and attaches only the scrubbed category', () => {
    const raw = new Error('storage exploded');
    reporter().report(raw, 'StorageError');
    expect(captureException).toHaveBeenCalledWith(raw, { 'error.category': 'StorageError' });
  });

  it('does not attach any free-form / user content beyond the category', () => {
    reporter().report(
      new Error('canon match: "two pounds of organic heirloom tomatoes"'),
      'SyncError',
    );
    const [, props] = captureException.mock.calls[0]!;
    // The only property attached is the category. No spread bag, no user text key.
    expect(Object.keys(props)).toEqual(['error.category']);
  });

  it('wraps a non-Error value so a thrown string still carries a stack', () => {
    reporter().report('plain string failure', 'StorageError');
    const [arg] = captureException.mock.calls[0]!;
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toBe('plain string failure');
  });
});
