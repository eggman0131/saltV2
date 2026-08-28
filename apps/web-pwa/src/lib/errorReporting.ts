import type { ErrorReportingPort } from '@salt/domain';
import type { DomainError, ReadResult, Result } from '@salt/shared-types';
import { isAuthTransitioning } from '@salt/firebase-sync';
import { getErrorReporter } from './errorReporter.js';

// Shared report path for realtime-subscription onError sites across the service
// layer (canon/chat/recipe/shopping). The category gate ("report the unexpected,
// suppress the expected") lives inside the injected port's report(); here we add
// the ONE extra suppression the category gate cannot make on its own: the
// sign-out / token-refresh teardown race.
//
// An in-flight Firestore listener fires `permission-denied` (→ AuthError) as the
// session tears down. AuthError is reportable by category, so without this check
// the teardown race would spam PostHog. While a transition is in flight we drop
// AuthError; a genuine rules-misconfig AuthError (no transition) still reports.
// Every other category passes straight to the port and is gated there.
//
// The RAW error is forwarded when the subscription supplies it (it carries the
// real stack); the synthetic DomainError is the fallback when there is none.
export function reportSubscriptionError(
  errors: ErrorReportingPort,
  err: DomainError,
  rawError?: unknown,
): void {
  if (err.kind === 'AuthError' && isAuthTransitioning()) return;
  errors.report(rawError ?? err, err.kind);
}

// The default shape of a subscription onError handler (issue #1053).
//
// Wrap whatever the call site already does and reporting comes for free:
//
//   subscribeMembers(onSnapshot, subscriptionErrorHandler(() => stopSpinner()))
//
// Report FIRST, then the caller's work, so a throw in caller code cannot lose
// the report. report() is best-effort and cannot itself throw (Rule 10,
// posthogErrorReportingAdapter.ts), so nothing is risked by going first.
//
// This adds a side-effect and nothing else: no control flow, no return value, no
// UI. A handler that deliberately shows the user nothing keeps showing nothing —
// reporting is telemetry, not a toast.
//
// The returned handler's SECOND PARAMETER IS OPTIONAL, and that is load-bearing.
// `(err, rawError?) => void` is assignable to a parameter typed
// `(err) => void`, so one handler fits both adapter arities — the eight
// one-argument subscription signatures in firebase-sync AND the two-argument
// ones — with no call-site branching. When #928 Phase 1 widens those eight, the
// raw Firestore error (which carries the real stack) starts flowing through to
// PostHog here with ZERO change at any call site. Do not narrow it.
export function subscriptionErrorHandler(
  onError?: (err: DomainError) => void,
): (err: DomainError, rawError?: unknown) => void {
  return (err, rawError) => {
    reportSubscriptionError(getErrorReporter(), err, rawError);
    onError?.(err);
  };
}

// Shared report path for WRITE/COMMAND failures across the service layer
// (canon/chat/recipe/shopping). Unlike reportSubscriptionError, this is for
// caller-initiated writes, NOT in-flight listeners — so it does NOT consult
// isAuthTransitioning(). A write that fails with AuthError is a genuine
// authorisation failure the user just triggered (not the sign-out teardown
// race, which only affects subscription listeners), so write-path AuthError IS
// reportable per policy.
//
// The category gate ("report the unexpected, suppress the expected") still
// lives inside the injected port's report(): suppressed categories
// (NetworkError/ValidationError/NotFound/ConflictError) no-op there, so callers
// just always call this on the err branch without branching on category.
//
// The RAW error is forwarded when the adapter supplies it (it carries the real
// stack); the synthetic DomainError is the fallback when there is none.
export function reportWriteError(
  errors: ErrorReportingPort,
  error: DomainError,
  rawError?: unknown,
): void {
  errors.report(rawError ?? error, error.kind);
}

// Ergonomic wrapper for the common one-line write site
// `return reportIfFailed(getErrorReporter(), await saveX(...))`. No-ops on
// `kind: 'ok'`, reports via reportWriteError on `kind: 'err'`, and returns the
// result UNCHANGED so it can be returned directly — reporting stays a pure
// side-effect that never alters control flow, return values, or toasts.
export function reportIfFailed<
  R extends Result<unknown, DomainError> | ReadResult<unknown, DomainError>,
>(errors: ErrorReportingPort, result: R, rawError?: unknown): R {
  if (result.kind === 'err') reportWriteError(errors, result.error, rawError);
  return result;
}
