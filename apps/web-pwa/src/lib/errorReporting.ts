import type { ErrorReportingPort } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { isAuthTransitioning } from '@salt/firebase-sync';

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
