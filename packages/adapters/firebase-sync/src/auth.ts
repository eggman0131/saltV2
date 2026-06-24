import {
  getAuth,
  connectAuthEmulator,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth';
import { getApp } from 'firebase/app';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { AuthProvider, User, ErrorReportingPort } from '@salt/domain';

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
        errors?.report(err);
        return failure(toAuthError(err));
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
        errors?.report(err);
        return failure(toAuthError(err));
      }
    },

    async signOut(): Promise<ReadResult<void, DomainError>> {
      try {
        await fbSignOut(auth);
        return success(undefined);
      } catch (err) {
        errors?.report(err);
        return failure(toAuthError(err));
      }
    },

    observe(callback: (user: User | null) => void): () => void {
      return onAuthStateChanged(auth, (fb) => {
        callback(fb ? toUser(fb) : null);
      });
    },

    getCurrentUser(): User | null {
      return auth.currentUser ? toUser(auth.currentUser) : null;
    },
  };
}
