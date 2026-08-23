import type { DomainError } from '@salt/shared-types';

// The ONE place a Firebase callable failure becomes a DomainError (issue #916).
//
// Why it lives here and not in `@salt/domain`: it knows the Firebase callable
// gRPC code vocabulary (`functions/internal`, `functions/unauthenticated`, …),
// which is a Firebase SDK concern. Domain is pure and must never import — or
// know about — Firebase (CLAUDE.md rule #1). This is the callable sibling of
// `classifyFirestoreError`, and sits beside it for the same reason.
//
// ─── The defect this file exists to prevent ────────────────────────────────
// Every callable wrapper used to end its catch with
// `return failure({ kind: 'NetworkError', reason: 'transient' })`. A Cloud
// Function 500 arrives at the browser SDK as `functions/internal` and fell into
// that catch-all, so two things followed: the user was told to check their
// connection when the SERVER was broken, and — because `NetworkError` is a
// deliberately SUPPRESSED category in the §7.6 reporting policy — the failure was
// never reported at all. `auth.ts:toOtpError` was fixed for the email-OTP path in
// #546 and the reasoning written down there; the other twenty-odd sites were
// never told. This is that fix, written once.
//
// ─── The ordering is load-bearing ──────────────────────────────────────────
// The `navigator.onLine` check comes FIRST, exactly as in `classifyFirestoreError`
// and `toOtpError`, because the callable SDK surfaces a genuinely failed fetch as
// `functions/internal` TOO — the error code alone cannot separate "server 500"
// from "no connection". Checking the code first would reclassify every offline
// failure as a reportable server fault, which would be a regression against §7.6,
// not a fix. Offline stays `NetworkError`, and stays suppressed.
//
// NEVER throws (Rule 10) — it takes `unknown` and always returns a DomainError.

/**
 * The gRPC status codes the Firebase callable SDK can surface, minus the
 * `functions/` prefix. Used to type `overrides` so a per-call-site arm cannot be
 * keyed off a code that will never arrive.
 */
const CALLABLE_ERROR_CODES = [
  'cancelled',
  'unknown',
  'invalid-argument',
  'deadline-exceeded',
  'not-found',
  'already-exists',
  'permission-denied',
  'resource-exhausted',
  'failed-precondition',
  'aborted',
  'out-of-range',
  'unimplemented',
  'internal',
  'unavailable',
  'data-loss',
  'unauthenticated',
] as const;

export type CallableErrorCode = (typeof CALLABLE_ERROR_CODES)[number];

/**
 * Per-call-site arms, keyed by the bare gRPC code.
 *
 * A callable that gives one code a bespoke meaning — `failed-precondition` is
 * "the kill switch is off", `invalid-argument` is "that image could not be used",
 * `not-found` is "the item was deleted under an open page" — declares it here
 * rather than re-writing the whole mapping. Overrides are consulted AFTER the
 * offline check, so no call site can accidentally turn a genuine offline failure
 * into a reportable one.
 */
export type CallableErrorOverrides = Partial<Record<CallableErrorCode, DomainError>>;

/**
 * Whether the browser says it is offline.
 *
 * Exported because a couple of callables map onto their OWN failure vocabulary
 * rather than `DomainError` (the URL and photo import classifiers, issue #740) and
 * so cannot delegate wholesale — but they still owe the user the same ordering:
 * offline is answered before any error code is read, because a failed fetch and a
 * server 500 arrive under the same code.
 */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

// Rule 10 in miniature: this is handed whatever the SDK rejected with, which is
// usually a FirebaseError but is not guaranteed to be one — or to be an object at
// all. Anything that is not a string `code` reads as "no code", never as a throw.
function callableCode(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
}

/**
 * Map a Firebase callable rejection to the `DomainError` contract.
 *
 * The catch-all is `StorageError: unavailable` — "something broke server-side" —
 * which is REPORTABLE under §7.6 and renders as an honest "that didn't work, try
 * again" rather than a claim about the user's connection. `NetworkError` is
 * reserved for failures that really are connectivity: the browser being offline,
 * and the codes that mean the request never reached a working function.
 */
export function classifyCallableError(
  err: unknown,
  overrides?: CallableErrorOverrides,
): DomainError {
  // FIRST, always — see the ordering note above.
  if (isBrowserOffline()) return { kind: 'NetworkError', reason: 'offline' };

  const code = callableCode(err);
  const override = overrides?.[code as CallableErrorCode];
  if (override) return override;

  switch (code) {
    case 'permission-denied':
      return { kind: 'AuthError', reason: 'forbidden' };

    case 'unauthenticated':
      return { kind: 'AuthError', reason: 'unauthenticated' };

    // The request never reached a working function, or was abandoned before it
    // answered. Genuinely transient, genuinely "try again", and correctly
    // suppressed: none of these is a defect anyone can act on.
    case 'unavailable':
    case 'deadline-exceeded':
    case 'cancelled':
    case 'aborted':
      return { kind: 'NetworkError', reason: 'transient' };

    // Mirrors classifyFirestoreError's two storage-flavoured arms.
    case 'resource-exhausted':
      return { kind: 'StorageError', reason: 'quota-exceeded' };

    case 'data-loss':
      return { kind: 'StorageError', reason: 'corruption' };

    // `internal` (the CF 500) lands here, together with every code we have not
    // given a meaning and every rejection carrying no code at all. Reportable by
    // §7.6 — an unrecognised failure is the unexpected, and the highest-signal
    // thing to surface.
    default:
      return { kind: 'StorageError', reason: 'unavailable' };
  }
}
