import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { EmailOtpVerifySchema } from '@salt/domain/schemas';
import { normaliseMemberEmail } from '@salt/domain';
import { APP_CHECK_SIGN_IN_EXEMPT } from '../tracedCallable.js';
import { reportFlowError } from '../observability/reportServerError.js';
import {
  OTP_COLLECTION,
  MAX_VERIFY_ATTEMPTS,
  hashEmail,
  hashCode,
  hashesEqual,
  type OtpDoc,
} from '../auth/otpStore.js';

const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// Generic copy for every incorrect/expired/absent-code path — deliberately does
// not distinguish, so a caller can't learn which state a code is in.
const BAD_CODE = 'That code is incorrect or has expired.';

// Email-OTP verify (issue #546). PUBLIC (the caller is signing in). On a correct,
// unexpired code from an allowlisted member, mints a Firebase custom token the
// client exchanges via signInWithCustomToken — which writes auth state into the
// CURRENT container, so it works inside a standalone iOS PWA.
//
// SECURITY: the Admin SDK bypasses the `beforeMemberCreated` blocking function,
// so this re-enforces the `members` allowlist itself before creating a user or
// minting a token — otherwise OTP would be a hole around the allowlist that
// magic link is gated by. That allowlist check, not App Check, is this endpoint's
// authz boundary — which is why it can stay App Check EXEMPT until #718 Phase 4
// flips the sign-in path alone (see APP_CHECK_SIGN_IN_EXEMPT). A caller without a
// valid code still gets nothing, and attempts are capped and burned.
export const verifyEmailOtp = onCall(
  {
    ...APP_CHECK_SIGN_IN_EXEMPT,
    region: 'europe-west2',
    secrets: [posthogApiKey],
    memory: '512MiB',
  },
  async (request) => {
    const parsed = EmailOtpVerifySchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'A valid email and 6-digit code are required.');
    }
    const email = normaliseMemberEmail(parsed.data.email);
    const code = parsed.data.code;
    const emailHash = hashEmail(email);
    const db = getFirestore();
    const ref = db.collection(OTP_COLLECTION).doc(emailHash);

    try {
      const snap = await ref.get();
      const otp = readOtp(snap);
      // No code on file, or corrupt — expected failure, not reported.
      if (!otp) throw new HttpsError('failed-precondition', BAD_CODE);

      const now = Date.now();
      if (now > otp.expiresAt) {
        await ref.delete();
        throw new HttpsError('failed-precondition', BAD_CODE);
      }
      if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
        await ref.delete();
        throw new HttpsError('failed-precondition', 'Too many attempts. Request a new code.');
      }

      if (!hashesEqual(otp.codeHash, hashCode(emailHash, code))) {
        // Wrong code — burn one attempt, keep the doc so the user can retry.
        await ref.update({ attempts: otp.attempts + 1 });
        throw new HttpsError('failed-precondition', BAD_CODE);
      }

      // Correct code. Re-enforce the members allowlist (Admin createUser bypasses
      // beforeMemberCreated). Off-list ⇒ deny and burn the code.
      const member = await db.collection('members').doc(email).get();
      if (!member.exists) {
        await ref.delete();
        logger.warn('verifyEmailOtp: correct code but off-list email', { emailHash });
        throw new HttpsError(
          'permission-denied',
          'This email address is not on the Salt member list. Ask an admin to add you.',
        );
      }

      const uid = await resolveUid(email);
      const token = await getAuth().createCustomToken(uid);
      // One-time use — consume the code on success.
      await ref.delete();
      return { token } as const;
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      // Unexpected Firestore/admin-auth failure — report scrubbed (no email/code
      // attached), then surface a generic internal error. Also log it: PostHog
      // reporting can be unconfigured or drop the payload, and without a CF-side
      // line these 500s leave NO trace in Cloud Logging at all (which is exactly
      // how the missing iam.serviceAccounts.signBlob grant stayed invisible).
      logger.error('verifyEmailOtp: unexpected failure', {
        emailHash,
        reason: err instanceof Error ? err.message : String(err),
      });
      await reportFlowError(err);
      throw new HttpsError('internal', 'Sign-in failed. Please try again.');
    }
  },
);

// Existing member → their uid; first-time member → create the account (allowed
// only after the allowlist check above). emailVerified:true because a delivered
// OTP proves control of the inbox.
async function resolveUid(email: string): Promise<string> {
  const auth = getAuth();
  try {
    const user = await auth.getUserByEmail(email);
    return user.uid;
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      const created = await auth.createUser({ email, emailVerified: true });
      return created.uid;
    }
    throw err;
  }
}

// Defensive read — a corrupt doc is treated as "no code on file".
function readOtp(snap: FirebaseFirestore.DocumentSnapshot): OtpDoc | null {
  if (!snap.exists) return null;
  const data = snap.data();
  if (
    !data ||
    typeof data['codeHash'] !== 'string' ||
    typeof data['expiresAt'] !== 'number' ||
    typeof data['attempts'] !== 'number'
  ) {
    return null;
  }
  return data as OtpDoc;
}
