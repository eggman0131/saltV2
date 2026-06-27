import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErrorReportingPort } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';

// Drive the auth-transition flag the service onError sites consult.
const isAuthTransitioning = vi.fn(() => false);
vi.mock('@salt/firebase-sync', () => ({
  isAuthTransitioning: () => isAuthTransitioning(),
}));

import {
  reportSubscriptionError,
  reportWriteError,
  reportIfFailed,
} from '../src/lib/errorReporting.js';
import type { ReadResult } from '@salt/shared-types';

describe('reportSubscriptionError (service-layer subscription onError gate)', () => {
  let report: ReturnType<typeof vi.fn>;
  let errors: ErrorReportingPort;

  beforeEach(() => {
    report = vi.fn();
    errors = { report };
    isAuthTransitioning.mockReturnValue(false);
  });

  it('forwards the RAW error (real stack), keyed by the categorised kind', () => {
    const raw = new Error('firestore blew up');
    const err: DomainError = { kind: 'StorageError', reason: 'unavailable' };
    reportSubscriptionError(errors, err, raw);
    expect(report).toHaveBeenCalledWith(raw, 'StorageError');
  });

  it('falls back to the synthetic DomainError when no raw error is supplied', () => {
    const err: DomainError = { kind: 'StorageError', reason: 'corruption' };
    reportSubscriptionError(errors, err);
    expect(report).toHaveBeenCalledWith(err, 'StorageError');
  });

  it('suppresses AuthError while an auth transition is in flight (teardown race)', () => {
    isAuthTransitioning.mockReturnValue(true);
    const err: DomainError = { kind: 'AuthError', reason: 'forbidden' };
    reportSubscriptionError(errors, err, new Error('permission-denied'));
    expect(report).not.toHaveBeenCalled();
  });

  it('reports a genuine AuthError when no transition is in flight (rules misconfig)', () => {
    isAuthTransitioning.mockReturnValue(false);
    const raw = new Error('permission-denied');
    const err: DomainError = { kind: 'AuthError', reason: 'forbidden' };
    reportSubscriptionError(errors, err, raw);
    expect(report).toHaveBeenCalledWith(raw, 'AuthError');
  });

  it('forwards non-Auth categories straight through even during a transition', () => {
    // The flag only ever gates AuthError; the report()-side category gate decides
    // the rest (a NetworkError still gets forwarded and is dropped there).
    isAuthTransitioning.mockReturnValue(true);
    const raw = new Error('offline');
    const err: DomainError = { kind: 'NetworkError', reason: 'offline' };
    reportSubscriptionError(errors, err, raw);
    expect(report).toHaveBeenCalledWith(raw, 'NetworkError');
  });
});

// The category GATE ("report the unexpected, suppress the expected") lives inside
// the real injected port's report() (isReportableCategory in @salt/observability,
// tested there). At the helper level the port is a bare mock, so these tests
// assert the helper FORWARDS every category to report() keyed by kind — the
// suppression happens downstream. The write-path distinction this layer DOES own:
// unlike reportSubscriptionError it never consults isAuthTransitioning(), so a
// write that fails with AuthError is forwarded (it's a real authz failure the
// user just triggered, not the listener teardown race).
describe('reportWriteError (service-layer write/command failure forwarder)', () => {
  let report: ReturnType<typeof vi.fn>;
  let errors: ErrorReportingPort;

  beforeEach(() => {
    report = vi.fn();
    errors = { report };
    isAuthTransitioning.mockReturnValue(false);
  });

  it('forwards the RAW error keyed by the categorised kind', () => {
    const raw = new Error('firestore write blew up');
    const err: DomainError = { kind: 'StorageError', reason: 'unavailable' };
    reportWriteError(errors, err, raw);
    expect(report).toHaveBeenCalledWith(raw, 'StorageError');
  });

  it('falls back to the synthetic DomainError when no raw error is supplied', () => {
    const err: DomainError = { kind: 'SyncError', reason: 'push-failed' };
    reportWriteError(errors, err);
    expect(report).toHaveBeenCalledWith(err, 'SyncError');
  });

  it('forwards write-path AuthError EVEN during an auth transition (no listener race here)', () => {
    // This is the key divergence from reportSubscriptionError: write paths are
    // caller-initiated, not in-flight listeners, so the teardown-race suppression
    // does not apply — an AuthError write failure must reach the port.
    isAuthTransitioning.mockReturnValue(true);
    const raw = new Error('permission-denied');
    const err: DomainError = { kind: 'AuthError', reason: 'forbidden' };
    reportWriteError(errors, err, raw);
    expect(report).toHaveBeenCalledWith(raw, 'AuthError');
  });

  it('forwards suppressed categories too (the port-side gate drops them, not the helper)', () => {
    const err: DomainError = { kind: 'NetworkError', reason: 'offline' };
    reportWriteError(errors, err);
    expect(report).toHaveBeenCalledWith(err, 'NetworkError');
  });
});

describe('reportIfFailed (ergonomic err-branch wrapper)', () => {
  let report: ReturnType<typeof vi.fn>;
  let errors: ErrorReportingPort;

  beforeEach(() => {
    report = vi.fn();
    errors = { report };
    isAuthTransitioning.mockReturnValue(false);
  });

  it('no-ops on a success result and returns it unchanged', () => {
    const ok: ReadResult<number, DomainError> = { kind: 'ok', value: 42 };
    const returned = reportIfFailed(errors, ok);
    expect(report).not.toHaveBeenCalled();
    expect(returned).toBe(ok);
  });

  it('reports on a failure result and returns it unchanged', () => {
    const err: ReadResult<number, DomainError> = {
      kind: 'err',
      error: { kind: 'StorageError', reason: 'quota-exceeded' },
    };
    const returned = reportIfFailed(errors, err);
    expect(report).toHaveBeenCalledWith(err.error, 'StorageError');
    expect(returned).toBe(err);
  });

  it('forwards the raw error when supplied, still returning the result unchanged', () => {
    const raw = new Error('boom');
    const err: ReadResult<number, DomainError> = {
      kind: 'err',
      error: { kind: 'SyncError', reason: 'pull-failed' },
    };
    const returned = reportIfFailed(errors, err, raw);
    expect(report).toHaveBeenCalledWith(raw, 'SyncError');
    expect(returned).toBe(err);
  });
});
