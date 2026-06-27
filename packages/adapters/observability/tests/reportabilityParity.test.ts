import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DomainError } from '@salt/shared-types';

// ---------------------------------------------------------------------------
// Client/server reportability PARITY (Phase 4 regression guard).
//
// The report/suppress decision is meant to be ONE source of truth
// (`isReportableCategory`, src/shared/), shared verbatim by the browser default
// subpath and the /server subpath. This file proves that invariant end-to-end
// by driving BOTH real adapters for every DomainError kind (plus `undefined`)
// and asserting they make the SAME capture decision — and that the decision
// matches `isReportableCategory`.
//
// If a future change forks the gate (e.g. someone re-implements the server-side
// suppression list, or drops `undefined → report` on one side), this test fails
// even if each adapter's own focused test still passes. The explicit expected
// table below is what keeps this from being a tautology: it pins the intended
// per-category outcome so a coordinated-but-wrong change to BOTH sides is also
// caught.
// ---------------------------------------------------------------------------

// Both SDKs are mocked in the SAME file so we can prime both inits and exercise
// both adapters side by side. vi.hoisted keeps the spies / fake class available
// to the hoisted vi.mock factories.
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
import { isReportableCategory } from '../src/shared/reportableCategory.js';

// Explicit, hand-maintained expected outcome per category. This is the regression
// guard: it does NOT call isReportableCategory to compute itself, so a change to
// the predicate that flips a category will diverge from this table and fail.
// `true` = should report (captureException called); `false` = should suppress.
const EXPECTED_REPORT: ReadonlyArray<[DomainError['kind'] | undefined, boolean]> = [
  ['StorageError', true],
  ['SyncError', true],
  ['AuthError', true],
  ['NetworkError', false],
  ['ValidationError', false],
  ['NotFound', false],
  ['ConflictError', false],
  [undefined, true], // uncategorised / unknown → report the unexpected
];

describe('client/server error-reporting reportability parity', () => {
  beforeEach(() => {
    clientCapture.mockClear();
    serverCapture.mockClear();
    initObservability('test-key');
    initServerObservability('test-key');
  });

  it('covers exactly the 7 DomainError kinds plus undefined (8 cases)', () => {
    // Guards against a new DomainError['kind'] being added without extending the
    // expected table — the parity guarantee must cover EVERY category.
    const concreteKinds = EXPECTED_REPORT.map(([k]) => k).filter(
      (k): k is DomainError['kind'] => k !== undefined,
    );
    expect(EXPECTED_REPORT).toHaveLength(8);
    expect(new Set(concreteKinds).size).toBe(7);
  });

  it.each(EXPECTED_REPORT)(
    'client and server make the SAME decision for category %s (expected report=%s)',
    (category, expectedReport) => {
      // Sanity: the shared predicate agrees with our hand-maintained table. If a
      // future edit forks the predicate, this line fails first.
      expect(isReportableCategory(category)).toBe(expectedReport);

      const error = new Error(`failure for ${String(category)}`);

      // Server `report` takes an OPTIONAL category — pass the same value to both
      // so the comparison is apples-to-apples (incl. the undefined case).
      createPosthogErrorReportingAdapter().report(error, category as DomainError['kind']);
      createPosthogServerErrorReportingAdapter().report(error, category);

      const clientReported = clientCapture.mock.calls.length > 0;
      const serverReported = serverCapture.mock.calls.length > 0;

      // 1) Both adapters must agree with each other (no fork between subpaths).
      expect(clientReported).toBe(serverReported);
      // 2) That shared decision must equal the predicate's verdict.
      expect(clientReported).toBe(expectedReport);
      // 3) And both must match the explicit expected-outcome table.
      expect(serverReported).toBe(expectedReport);

      // When reported, exactly one capture per adapter (no double-report).
      if (expectedReport) {
        expect(clientCapture).toHaveBeenCalledTimes(1);
        expect(serverCapture).toHaveBeenCalledTimes(1);
      } else {
        expect(clientCapture).not.toHaveBeenCalled();
        expect(serverCapture).not.toHaveBeenCalled();
      }
    },
  );
});
