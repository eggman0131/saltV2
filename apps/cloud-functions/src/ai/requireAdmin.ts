import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';
import { logger } from 'firebase-functions';
import { normaliseMemberEmail } from '@salt/domain';
import { MemberSchema } from '@salt/domain/schemas';

// Server-side admin re-check for operator-only callables (issue #155). The
// client-side AdminGuard is UX-only — it merely hides screens — so every
// admin-only Cloud Function MUST re-verify the caller server-side. There is no
// shared helper yet, so this is it: read the caller's `members/{email}` doc
// directly via the Admin SDK (CFs must NOT import @salt/firebase-sync) and
// require `admin === true`.
//
// The members doc is keyed by the normalised email, matching how the browser
// roster + AdminGuard look the caller up.

/**
 * Throws an HttpsError unless the request is from a signed-in member whose
 * roster doc has `admin === true`. Returns the caller's normalised email on
 * success (handy for audit metadata).
 */
export async function requireAdmin(request: CallableRequest): Promise<string> {
  const email = request.auth?.token?.email;
  if (!request.auth || !email) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const normalised = normaliseMemberEmail(email);

  let snap;
  try {
    snap = await getFirestore().collection('members').doc(normalised).get();
  } catch (err) {
    logger.error('requireAdmin: members read failed', { err });
    // Fail closed: if we cannot confirm admin, deny.
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  const parsed = MemberSchema.safeParse(snap.data());
  if (!parsed.success || parsed.data.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  return normalised;
}
