import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErrorReportingPort } from '@salt/domain';

// ─── Mock the Firebase SDKs createFirebaseAuth leans on ─────────────────────────
// getAuth/getApp just need to return a stable handle; the auth methods are spies
// whose resolve/reject we drive per test. onAuthStateChanged lets us simulate the
// post-sign-out null transition that clears the auth-transition flag.
const sendSignInLinkToEmail = vi.fn();
const signInWithEmailLink = vi.fn();
const fbSignOut = vi.fn();
let authStateListener: ((user: unknown) => void) | null = null;

vi.mock('firebase/app', () => ({ getApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
  connectAuthEmulator: vi.fn(),
  sendSignInLinkToEmail: (...a: unknown[]) => sendSignInLinkToEmail(...a),
  isSignInWithEmailLink: vi.fn(),
  signInWithEmailLink: (...a: unknown[]) => signInWithEmailLink(...a),
  signOut: (...a: unknown[]) => fbSignOut(...a),
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authStateListener = cb;
    return vi.fn();
  },
}));

import { createFirebaseAuth } from '../src/auth.js';
import { isAuthTransitioning, setAuthTransitioning } from '../src/authTransition.js';

function fbAuthError(code: string): Error & { code: string } {
  const e = new Error(`Firebase: ${code}`) as Error & { code: string };
  e.code = code;
  return e;
}

describe('auth-transition flag', () => {
  beforeEach(() => {
    setAuthTransitioning(false);
    sendSignInLinkToEmail.mockReset();
    signInWithEmailLink.mockReset();
    fbSignOut.mockReset();
    authStateListener = null;
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('set/read round-trips', () => {
    expect(isAuthTransitioning()).toBe(false);
    setAuthTransitioning(true);
    expect(isAuthTransitioning()).toBe(true);
    setAuthTransitioning(false);
    expect(isAuthTransitioning()).toBe(false);
  });

  it('signOut opens the transition window; the null auth-state settle closes it', async () => {
    fbSignOut.mockResolvedValue(undefined);
    const provider = createFirebaseAuth(null);
    provider.observe(() => {}); // attach the listener that clears the flag

    const p = provider.signOut();
    expect(isAuthTransitioning()).toBe(true); // window open before teardown completes
    await p;
    expect(isAuthTransitioning()).toBe(true); // still open until auth settles

    // Firebase reports the user signed out → flag clears.
    authStateListener?.(null);
    expect(isAuthTransitioning()).toBe(false);
  });

  it('suppresses the AuthError teardown race while a transition is in flight', async () => {
    const report = vi.fn();
    const errors: ErrorReportingPort = { report };
    const provider = createFirebaseAuth(errors);

    setAuthTransitioning(true);
    // permission-denied / unauthenticated during teardown → AuthError, suppressed.
    signInWithEmailLink.mockRejectedValue(fbAuthError('auth/internal-error'));
    await provider.completeMagicLink('url', 'a@b.com');
    expect(report).not.toHaveBeenCalled();
  });

  it('reports a genuine AuthError when no transition is in flight', async () => {
    const report = vi.fn();
    const errors: ErrorReportingPort = { report };
    const provider = createFirebaseAuth(errors);

    const raw = fbAuthError('auth/internal-error'); // → AuthError:unauthenticated
    signInWithEmailLink.mockRejectedValue(raw);
    await provider.completeMagicLink('url', 'a@b.com');

    expect(report).toHaveBeenCalledTimes(1);
    // Categorise-first: the RAW error is reported, keyed by the categorised kind.
    expect(report).toHaveBeenCalledWith(raw, 'AuthError');
  });

  it('reports a non-Auth category (NetworkError) even during a transition', async () => {
    const report = vi.fn();
    const errors: ErrorReportingPort = { report };
    const provider = createFirebaseAuth(errors);

    setAuthTransitioning(true); // the flag only ever suppresses AuthError
    const raw = fbAuthError('auth/network-request-failed'); // → NetworkError
    sendSignInLinkToEmail.mockRejectedValue(raw);
    await provider.sendMagicLink('a@b.com', 'https://x');

    expect(report).toHaveBeenCalledWith(raw, 'NetworkError');
  });

  it('signOut failure closes the window and reports (genuine, not the race)', async () => {
    const report = vi.fn();
    const errors: ErrorReportingPort = { report };
    const provider = createFirebaseAuth(errors);

    const raw = fbAuthError('auth/internal-error');
    fbSignOut.mockRejectedValue(raw);
    await provider.signOut();

    // The sign-out itself failed, so the session is NOT tearing down: window
    // closes and the AuthError reports.
    expect(isAuthTransitioning()).toBe(false);
    expect(report).toHaveBeenCalledWith(raw, 'AuthError');
  });
});
