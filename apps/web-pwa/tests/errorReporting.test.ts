import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErrorReportingPort } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';

// Drive the auth-transition flag the service onError sites consult.
const isAuthTransitioning = vi.fn(() => false);
vi.mock('@salt/firebase-sync', () => ({
  isAuthTransitioning: () => isAuthTransitioning(),
}));

import { reportSubscriptionError } from '../src/lib/errorReporting.js';

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
