import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ErrorReportingPort } from '@salt/domain';

// Classification + reporting for the email-OTP sign-in path (issue #546).
//
// Regression cover for the mislabelling that made a server fault look like a
// connectivity problem: `verifyEmailOtp` 500'd on a missing
// iam.serviceAccounts.signBlob grant, the catch-all mapped `functions/internal`
// to NetworkError, and the user was told to "check your connection" while the
// report was silently suppressed (NetworkError is a suppressed category).

const requestOtp = vi.fn(async () => undefined);
const verifyOtp = vi.fn(async () => 'custom-token');
vi.mock('../src/emailOtpCallables.js', () => ({
  callRequestEmailOtp: (email: string) => requestOtp(email),
  callVerifyEmailOtp: (email: string, code: string) => verifyOtp(email, code),
}));

const signInWithCustomToken = vi.fn(async () => ({ user: { uid: 'u1', email: 'a@b.c' } }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  isSignInWithEmailLink: vi.fn(),
  signInWithEmailLink: vi.fn(),
  signInWithCustomToken: (...args: unknown[]) => signInWithCustomToken(...(args as [])),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));
vi.mock('firebase/app', () => ({ getApp: vi.fn(() => ({})) }));

const { createFirebaseAuth } = await import('../src/auth.js');

function callableError(code: string): Error & { code: string } {
  const err = new Error(`Firebase: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

let errors: ErrorReportingPort & { report: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  // Node >= 21 exposes navigator globally with onLine = false, which would send
  // every case down the offline branch. Stub online for all but the offline test.
  vi.stubGlobal('navigator', { onLine: true });
  errors = { report: vi.fn() } as ErrorReportingPort & { report: ReturnType<typeof vi.fn> };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signInWithEmailCode — error classification', () => {
  it('maps a server 500 (functions/internal) to a REPORTED StorageError, not NetworkError', async () => {
    verifyOtp.mockRejectedValueOnce(callableError('functions/internal'));
    const result = await createFirebaseAuth(errors).signInWithEmailCode('a@b.c', '123456');

    expect(result).toEqual({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } });
    expect(errors.report).toHaveBeenCalledTimes(1);
    expect(errors.report.mock.calls[0]![1]).toBe('StorageError');
  });

  it('maps a wrong/expired code to AuthError:expired and does NOT report it', async () => {
    verifyOtp.mockRejectedValueOnce(callableError('functions/failed-precondition'));
    const result = await createFirebaseAuth(errors).signInWithEmailCode('a@b.c', '123456');

    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'expired' } });
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('maps an off-allowlist email to AuthError:forbidden and does NOT report it', async () => {
    verifyOtp.mockRejectedValueOnce(callableError('functions/permission-denied'));
    const result = await createFirebaseAuth(errors).signInWithEmailCode('a@b.c', '123456');

    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('prefers the offline signal over the error code — the SDK reports a failed fetch as functions/internal too', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    verifyOtp.mockRejectedValueOnce(callableError('functions/internal'));
    const result = await createFirebaseAuth(errors).signInWithEmailCode('a@b.c', '123456');

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'offline' } });
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('treats functions/unavailable as a genuinely transient NetworkError', async () => {
    verifyOtp.mockRejectedValueOnce(callableError('functions/unavailable'));
    const result = await createFirebaseAuth(errors).signInWithEmailCode('a@b.c', '123456');

    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'transient' } });
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('succeeds without reporting when the token exchange works', async () => {
    const result = await createFirebaseAuth(errors).signInWithEmailCode('a@b.c', '123456');

    expect(result).toEqual({ kind: 'ok', value: { uid: 'u1', email: 'a@b.c' } });
    expect(errors.report).not.toHaveBeenCalled();
  });
});

describe('requestEmailCode — error classification', () => {
  it('reports a server 500 as StorageError', async () => {
    requestOtp.mockRejectedValueOnce(callableError('functions/internal'));
    const result = await createFirebaseAuth(errors).requestEmailCode('a@b.c');

    expect(result).toEqual({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } });
    expect(errors.report).toHaveBeenCalledTimes(1);
  });

  it('does not report an invalid-argument rejection', async () => {
    requestOtp.mockRejectedValueOnce(callableError('functions/invalid-argument'));
    const result = await createFirebaseAuth(errors).requestEmailCode('nope');

    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'expired' } });
    expect(errors.report).not.toHaveBeenCalled();
  });
});
