import { Timestamp } from 'firebase-admin/firestore';

// How long a `timerDeliveries` ledger doc outlives its delivery (issue #1008).
//
// The ledger's only job is exactly-once delivery under Cloud Tasks'
// at-least-once dispatch. A duplicate can only arrive within the retry window —
// five attempts over minutes (`retryConfig` in the three dispatch triggers) —
// and a re-timed timer changes the ledger key, so old keys never recur. A
// fortnight is therefore three orders of magnitude of margin, squarely "days,
// not months", and reuses the fortnight chat retention already established
// rather than minting a new arbitrary number.
//
// The TTL policy goes on `expiresAt`, NEVER on `deliveredAt`: a Firestore TTL
// field IS the expiry instant, so a policy on `deliveredAt` would mark every
// ledger doc expired at the moment it is created and race the sweep against the
// duplicate-dispatch window — a re-notification bug waiting for an unlucky
// sweep. A dedicated field saying when the doc STOPS MATTERING is the honest
// shape, and it makes the two swept collections' policies identical
// (`expiresAt` on `chatSessions` and `timerDeliveries` alike — one command
// shape in docs/runbooks/ttl-policies.md).
const DAY_MS = 24 * 60 * 60 * 1000;
export const TIMER_DELIVERY_RETENTION_MS = 14 * DAY_MS;

/**
 * The Timestamp pair every ledger claim carries. One clock read, so
 * `expiresAt` sits exactly `TIMER_DELIVERY_RETENTION_MS` after `deliveredAt`;
 * one implementation, so the three producers cannot drift on the shape the
 * TTL policy depends on — the field type is the half the repo controls, and
 * the trigger unit tests hold every producer to it.
 */
export function timerDeliveryStamp(): { deliveredAt: Timestamp; expiresAt: Timestamp } {
  const deliveredAtMs = Date.now();
  return {
    deliveredAt: Timestamp.fromMillis(deliveredAtMs),
    expiresAt: Timestamp.fromMillis(deliveredAtMs + TIMER_DELIVERY_RETENTION_MS),
  };
}
