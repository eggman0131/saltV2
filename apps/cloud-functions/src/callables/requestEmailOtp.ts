import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { EmailOtpRequestSchema } from '@salt/domain/schemas';
import { normaliseMemberEmail } from '@salt/domain';
import { reportFlowError } from '../observability/reportServerError.js';
import { sendOtpEmail } from '../adapters/sendOtpEmail.js';
import {
  OTP_COLLECTION,
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  hashEmail,
  hashCode,
  generateCode,
  type OtpDoc,
} from '../auth/otpStore.js';

// Resend API key for OTP delivery + PostHog for reporting the unexpected. Both
// bound per-function; reporting no-ops when POSTHOG_API_KEY is unset.
const resendApiKey = defineSecret('RESEND_API_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');
// The OTP sender address, e.g. `Salt <no-reply@salt.pendery.org>`. Not sensitive,
// but Secret Manager is the ONLY runtime-config channel a deployed function here
// has (the `dist` deploy source is wiped by every build, so a `.env` cannot
// survive) — so it rides as a secret, exactly like VAPID_PUBLIC_KEY. Must be on a
// Resend-verified domain, and set per environment.
const otpEmailFrom = defineSecret('OTP_EMAIL_FROM');

// Email-OTP request (issue #546). PUBLIC — the caller is signing in, not signed
// in yet, so there is deliberately no request.auth guard (App Check monitor-first
// is the platform abuse control). Region/memory pinned inline like the other
// top-imported callables (they run before index.ts's setGlobalOptions).
//
// Enumeration-safe: ALWAYS returns { ok: true }. A code is generated + emailed
// only for an email on the `members` allowlist (so strangers are never emailed
// and membership can't be probed from the response). Per-email cooldown bounds
// resend spam. The real authz boundary is verifyEmailOtp, which re-checks the
// allowlist before minting a token.
export const requestEmailOtp = onCall(
  {
    region: 'europe-west2',
    enforceAppCheck: false,
    secrets: [resendApiKey, posthogApiKey, otpEmailFrom],
    memory: '512MiB',
  },
  async (request) => {
    const parsed = EmailOtpRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'A valid email address is required.');
    }
    const email = normaliseMemberEmail(parsed.data.email);
    const emailHash = hashEmail(email);
    const db = getFirestore();
    const ref = db.collection(OTP_COLLECTION).doc(emailHash);

    try {
      // Only send to allowlisted members. Off-list emails get the same generic
      // success with no side effect — no stranger emails, no enumeration.
      const member = await db.collection('members').doc(email).get();
      if (!member.exists) {
        logger.info('requestEmailOtp: off-list email, no code sent', { emailHash });
        return { ok: true } as const;
      }

      // Per-email resend cooldown: within the window, keep the existing code and
      // no-op the send (still a generic success to the caller).
      const now = Date.now();
      const existing = existingOtp(await ref.get());
      if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
        logger.info('requestEmailOtp: within resend cooldown, not resending', { emailHash });
        return { ok: true } as const;
      }

      // Generate + send FIRST; only persist the code once the email is away, so a
      // send failure never leaves a dangling code or clobbers a still-valid one.
      const code = generateCode();
      const sent = await sendOtpEmail(resendApiKey.value(), otpEmailFrom.value(), email, code);
      if (!sent.ok) {
        // Unexpected delivery failure (Resend down, unverified sender, bad key) —
        // report scrubbed (no email/code attached) and surface a retryable error.
        // Also log it: PostHog reporting can be unconfigured or drop the payload,
        // and without a CF-side line a send failure is undiagnosable.
        logger.error('requestEmailOtp: send failed', {
          emailHash,
          reason: sent.error instanceof Error ? sent.error.message : String(sent.error),
        });
        await reportFlowError(sent.error);
        throw new HttpsError('internal', 'Could not send the code. Please try again.');
      }

      const doc: OtpDoc = {
        emailHash,
        codeHash: hashCode(emailHash, code),
        expiresAt: now + CODE_TTL_MS,
        attempts: 0,
        createdAt: now,
        lastSentAt: now,
      };
      await ref.set(doc);
      return { ok: true } as const;
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      // Unexpected Firestore/admin failure — report scrubbed, then surface.
      await reportFlowError(err);
      throw new HttpsError('internal', 'Could not send the code. Please try again.');
    }
  },
);

// Validate a stored OTP doc defensively; a corrupt doc is treated as absent.
function existingOtp(snap: FirebaseFirestore.DocumentSnapshot): OtpDoc | null {
  if (!snap.exists) return null;
  const data = snap.data();
  if (
    !data ||
    typeof data['codeHash'] !== 'string' ||
    typeof data['lastSentAt'] !== 'number' ||
    typeof data['expiresAt'] !== 'number'
  ) {
    return null;
  }
  return data as OtpDoc;
}
