import { getFunctions, httpsCallable } from 'firebase/functions';
import { FUNCTIONS_REGION } from './functionsRegion.js';

// Browser → email-OTP sign-in callables (issue #546). CLAUDE.md Rule 2: the
// Firebase SDK is only touched in firebase-sync. These thin wrappers throw the
// raw callable error; the auth adapter (auth.ts) maps it to DomainError and
// returns a ReadResult. Mirrors the other *Callables.ts helpers.

/** Ask the server to email a 6-digit code. Always resolves for a valid email
 * (the server is enumeration-safe); rejects only on transport failure. */
export async function callRequestEmailOtp(email: string): Promise<void> {
  const fn = httpsCallable<{ email: string }, { ok: boolean }>(
    getFunctions(undefined, FUNCTIONS_REGION),
    'requestEmailOtp',
  );
  await fn({ email });
}

/** Verify a code; resolves to a Firebase custom token on success, rejects with
 * the callable error (failed-precondition = wrong/expired) otherwise. */
export async function callVerifyEmailOtp(email: string, code: string): Promise<string> {
  const fn = httpsCallable<{ email: string; code: string }, { token: string }>(
    getFunctions(undefined, FUNCTIONS_REGION),
    'verifyEmailOtp',
  );
  const res = await fn({ email, code });
  return res.data.token;
}
