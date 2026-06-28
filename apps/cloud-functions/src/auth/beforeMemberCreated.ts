import { beforeUserCreated, HttpsError } from 'firebase-functions/identity';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { normaliseMemberEmail } from '@salt/domain';

// Auth blocking function (issue #155). Rejects account creation for any email
// not present in the `members` allowlist, so a stranger who reaches the login
// screen can never create an account. Requires Identity Platform.
//
// The allowlist key is the normalised email (matching the member doc id and the
// security-rule lookup); we normalise the incoming email the same way before
// the lookup so casing/whitespace can't be used to slip past the gate.
//
// Throwing HttpsError aborts account creation and surfaces the message to the
// client; returning normally allows it.
export const beforeMemberCreated = beforeUserCreated(
  // memory: 512MiB floor, pinned inline (top-imported, runs before
  // setGlobalOptions — same reason region is inline).
  { region: 'europe-west2', memory: '512MiB' },
  async (event) => {
    const rawEmail = event.data?.email;
    if (!rawEmail) {
      logger.warn('beforeMemberCreated: rejected account with no email');
      throw new HttpsError('permission-denied', 'An email address is required to use Salt.');
    }

    const email = normaliseMemberEmail(rawEmail);
    const snap = await getFirestore().collection('members').doc(email).get();
    if (!snap.exists) {
      logger.warn('beforeMemberCreated: rejected off-list email', { email });
      throw new HttpsError(
        'permission-denied',
        'This email address is not on the Salt member list. Ask an admin to add you.',
      );
    }

    logger.info('beforeMemberCreated: allowed member', { email });
  },
);
