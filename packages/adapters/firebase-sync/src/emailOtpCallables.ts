import { invokeCallable } from './callFunction.js';

// Browser → email-OTP sign-in callables (issue #546). CLAUDE.md Rule 2: the
// Firebase SDK is only touched in firebase-sync.
//
// `invokeCallable` rather than `callFunction`, and the difference IS the
// contract: these two throw the raw callable error, and the auth adapter
// (auth.ts) maps it onto the OTP vocabulary — a wrong code, an expired code, too
// many attempts — which it can only do if the error reaches it unmapped. That is
// Rule 10's stated exception rather than an oversight; giving them the shared
// `Failure` return would turn every wrong-code message into a generic one.

/** Ask the server to email a 6-digit code. Always resolves for a valid email
 * (the server is enumeration-safe); rejects only on transport failure. */
export async function callRequestEmailOtp(email: string): Promise<void> {
  await invokeCallable<{ email: string }, { ok: boolean }>({
    name: 'requestEmailOtp',
    input: { email },
  });
}

/** Verify a code; resolves to a Firebase custom token on success, rejects with
 * the callable error (failed-precondition = wrong/expired) otherwise. */
export async function callVerifyEmailOtp(email: string, code: string): Promise<string> {
  const data = await invokeCallable<{ email: string; code: string }, { token: string }>({
    name: 'verifyEmailOtp',
    input: { email, code },
  });
  return data.token;
}
