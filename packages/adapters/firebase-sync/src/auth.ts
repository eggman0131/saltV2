import {
  getAuth,
  connectAuthEmulator,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithCustomToken,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth';
import { getApp } from 'firebase/app';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { AuthProvider, User, ErrorReportingPort } from '@salt/domain';
import { setAuthTransitioning, isAuthTransitioning } from './authTransition.js';
import { callRequestEmailOtp, callVerifyEmailOtp } from './emailOtpCallables.js';
import { classifyCallableError } from './callableErrors.js';

// Keyed to the Auth instance (not a module-global boolean) so a re-created
// default app — as the emulator integration suite does per test, #319 — gets
// its fresh Auth wired to the emulator rather than skipped by a stale flag.
const authEmulatorConnected = new WeakSet<Auth>();

// Composition helper: connect the Auth emulator. Called from initFirebase
// when useEmulators=true. Idempotent per Auth instance.
export function connectAuthEmulatorOnce(auth: Auth): void {
  if (authEmulatorConnected.has(auth)) return;
  const _env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const authPort = _env['VITE_EMULATOR_AUTH_PORT'] ?? '9099';
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, { disableWarnings: true });
  authEmulatorConnected.add(auth);
}

function toUser(fb: FirebaseUser): User {
  return { uid: fb.uid, email: fb.email };
}

// Map Firebase Auth errors into the DomainError contract. Unknown codes fall
// through as 'unauthenticated' — adapters never leak Firebase types.
function toAuthError(err: unknown): DomainError {
  const code = (err as { code?: string } | null)?.code ?? '';
  if (code === 'auth/user-token-expired' || code === 'auth/expired-action-code') {
    return { kind: 'AuthError', reason: 'expired' };
  }
  if (code === 'auth/network-request-failed' || code === 'auth/timeout') {
    return { kind: 'NetworkError', reason: 'unreachable' };
  }
  return { kind: 'AuthError', reason: 'unauthenticated' };
}

// Categorise-first reporting for auth catch sites: the gate runs on the
// DomainError category, not the raw error. The RAW error is what's reported (so
// PostHog gets the real stack), keyed by the categorised kind. While a sign-out /
// token-refresh transition is in flight we additionally suppress AuthError — the
// teardown `permission-denied` race — distinguishing it from a genuine
// rules-misconfig AuthError (no transition in flight), which still reports.
function reportAuthFailure(
  errors: ErrorReportingPort | null,
  rawError: unknown,
  domainError: DomainError,
): void {
  if (domainError.kind === 'AuthError' && isAuthTransitioning()) return;
  errors?.report(rawError, domainError.kind);
}

// Map the OTP callable error codes to DomainError. A wrong/expired/absent code
// (failed-precondition) or malformed input (invalid-argument) surfaces as
// AuthError.expired so the login UI shows a "code incorrect or expired" message
// rather than a network one; an off-allowlist email surfaces as forbidden.
// Unexpected server failures already report themselves server-side, so these are
// NOT re-reported here (they are expected user outcomes or plain network faults).
// Callable failures split two ways. EXPECTED: the ordinary OTP outcomes that each
// have their own user-facing copy (wrong/expired code, off-allowlist email) — these
// stay AuthError and are deliberately not reported. UNEXPECTED: a server fault,
// which must NOT be dressed up as a connectivity problem. A CF 500 arrives as
// `functions/internal`, and the old catch-all mapped it to NetworkError — which
// both told the user to "check your connection" and SUPPRESSED the report
// (NetworkError is a suppressed category). It now falls to the StorageError
// catch-all, mirroring classifyFirestoreError: reportable, and rendered by
// formatOtpError as the honest "Sign-in failed. Please try again."
//
// The offline check comes FIRST, exactly as in classifyFirestoreError, because the
// callable SDK surfaces a failed fetch as `functions/internal` TOO — the error code
// alone cannot separate "server 500" from "no connection".
//
// Since #916 this is the SHARED `classifyCallableError`, which was generalised
// from the version that used to live here: everything above is now the contract
// every callable wrapper in this package gets, and the only thing left for the OTP
// path to say is its two bespoke arms. Off-allowlist (`permission-denied` →
// forbidden), the session codes and the transient codes are all the shared
// default; only "that code is wrong, expired, or malformed" is peculiar to
// sign-in, where a network-flavoured message would be actively misleading.
function toOtpError(err: unknown): DomainError {
  return classifyCallableError(err, {
    'failed-precondition': { kind: 'AuthError', reason: 'expired' },
    'invalid-argument': { kind: 'AuthError', reason: 'expired' },
  });
}

// Report only the UNEXPECTED bucket from toOtpError. The AuthError outcomes it
// produces are the ordinary OTP failure modes — a mistyped code, an off-list email
// — and filing each one in error tracking would be pure noise, so this narrows the
// general "AuthError is reportable" policy for this flow specifically. StorageError
// is the only category toOtpError uses for "something broke server-side".
function reportOtpFailure(
  errors: ErrorReportingPort | null,
  rawError: unknown,
  domainError: DomainError,
): void {
  if (domainError.kind !== 'StorageError') return;
  errors?.report(rawError, domainError.kind);
}

export function createFirebaseAuth(errors: ErrorReportingPort | null = null): AuthProvider {
  const auth = getAuth(getApp());

  return {
    async sendMagicLink(
      email: string,
      continueUrl: string,
    ): Promise<ReadResult<void, DomainError>> {
      try {
        await sendSignInLinkToEmail(auth, email, {
          url: continueUrl,
          handleCodeInApp: true,
        });
        return success(undefined);
      } catch (err) {
        const domainError = toAuthError(err);
        reportAuthFailure(errors, err, domainError);
        return failure(domainError);
      }
    },

    isMagicLink(url: string): boolean {
      return isSignInWithEmailLink(auth, url);
    },

    async completeMagicLink(url: string, email: string): Promise<ReadResult<User, DomainError>> {
      try {
        const cred = await signInWithEmailLink(auth, email, url);
        return success(toUser(cred.user));
      } catch (err) {
        const domainError = toAuthError(err);
        reportAuthFailure(errors, err, domainError);
        return failure(domainError);
      }
    },

    async requestEmailCode(email: string): Promise<ReadResult<void, DomainError>> {
      try {
        await callRequestEmailOtp(email);
        return success(undefined);
      } catch (err) {
        // Only transport/server failures reject here; wrong-code lives on the
        // verify call. Expected outcomes are not reported (see reportOtpFailure).
        const domainError = toOtpError(err);
        reportOtpFailure(errors, err, domainError);
        return failure(domainError);
      }
    },

    async signInWithEmailCode(email: string, code: string): Promise<ReadResult<User, DomainError>> {
      try {
        const token = await callVerifyEmailOtp(email, code);
        // Custom-token sign-in writes auth state into the CURRENT container, so
        // it completes inside a standalone iOS PWA (unlike the magic-link Safari
        // hand-off).
        const cred = await signInWithCustomToken(auth, token);
        return success(toUser(cred.user));
      } catch (err) {
        const domainError = toOtpError(err);
        reportOtpFailure(errors, err, domainError);
        return failure(domainError);
      }
    },

    async signOut(): Promise<ReadResult<void, DomainError>> {
      // Open the transition window BEFORE tearing down the session: in-flight
      // Firestore listeners fire `permission-denied` (→ AuthError) as the rules
      // stop matching the now-signed-out user. The flag suppresses that expected
      // race at every AuthError report site until auth state settles to null.
      setAuthTransitioning(true);
      try {
        await fbSignOut(auth);
        return success(undefined);
      } catch (err) {
        // Sign-out itself failed: the session is NOT actually tearing down, so
        // close the window immediately — this AuthError is genuine, not the race.
        setAuthTransitioning(false);
        const domainError = toAuthError(err);
        reportAuthFailure(errors, err, domainError);
        return failure(domainError);
      }
    },

    observe(callback: (user: User | null) => void): () => void {
      return onAuthStateChanged(auth, (fb) => {
        // Auth state has settled. Once the user is null, the sign-out teardown is
        // complete and the listener race window is closed — clear the flag so a
        // subsequent genuine AuthError reports normally.
        if (!fb) setAuthTransitioning(false);
        callback(fb ? toUser(fb) : null);
      });
    },

    getCurrentUser(): User | null {
      return auth.currentUser ? toUser(auth.currentUser) : null;
    },
  };
}
