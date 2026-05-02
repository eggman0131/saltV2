import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const MANIFEST_PATH = 'canonManifest/global';

// One-shot bootstrap: creates canonManifest/global if it doesn't already exist.
// Requires authentication. Role-gating (admin-only) is tracked as a follow-up
// once the workspace module lands.
export const initManifest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const db = getFirestore();
  const manifestRef = db.doc(MANIFEST_PATH);
  const snap = await manifestRef.get();

  if (snap.exists) {
    logger.info('initManifest: document already exists, skipping');
    return { created: false };
  }

  await manifestRef.set({
    itemsRevision: 0,
    aislesRevision: 0,
    latestItemsUpdatedAt: null,
    latestAislesUpdatedAt: null,
    latestRevisionAt: null,
  });

  logger.info('initManifest: created canonManifest/global');
  return { created: true };
});
