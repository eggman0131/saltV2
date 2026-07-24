import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

// Shared helpers for the email-OTP sign-in callables (issue #546). Pure
// crypto + constants; the Firestore reads/writes live in the callables. Node's
// built-in crypto is fine here — this is cloud-functions, not the pure domain
// (Rule 1 forbids Node built-ins in packages/domain only).

// Server-only collection. firestore.rules denies all client access; the Admin
// SDK (used here) bypasses rules. Keyed by the hashed email so no raw address
// is ever a document id.
export const OTP_COLLECTION = 'emailOtps';

// 6-digit code, ~10 min TTL, 5 verify attempts, 30s resend cooldown. Tuned for
// a family app: short enough to be safe, forgiving enough to type.
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 30 * 1000;

export interface OtpDoc {
  emailHash: string;
  codeHash: string;
  expiresAt: number; // epoch ms
  attempts: number;
  createdAt: number; // epoch ms
  lastSentAt: number; // epoch ms
}

// SHA-256 of the normalised email → the document id. Never store the raw email.
export function hashEmail(normalisedEmail: string): string {
  return createHash('sha256').update(normalisedEmail).digest('hex');
}

// Hash the code bound to the email (email as salt) so the stored hash is useless
// against a different account and can't be pre-computed into a rainbow table.
export function hashCode(emailHash: string, code: string): string {
  return createHash('sha256').update(`${emailHash}:${code}`).digest('hex');
}

// Cryptographically-random 6-digit code, zero-padded (000000–999999).
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// Constant-time comparison of two hex digests — avoids leaking match progress
// through timing. Both are SHA-256 hex (64 chars); a length mismatch is a
// non-match without calling timingSafeEqual (which throws on unequal lengths).
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
