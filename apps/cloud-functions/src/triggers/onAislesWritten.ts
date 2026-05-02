import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { classifyAdminFirestoreError } from './errorCategory.js';

const MANIFEST_PATH = 'canonManifest/global';
const AISLES_DOC_PATH = 'canonData/aisles';

// Only the CF ever increases revision; afterRevision > beforeRevision means
// this is a re-trigger from our own stamp write — skip to avoid an infinite loop.
export async function handleAislesWritten(
  db: Firestore,
  beforeData: Record<string, unknown> | undefined,
  afterData: Record<string, unknown> | undefined,
  afterRef: DocumentReference | undefined,
): Promise<void> {
  const afterRevision = typeof afterData?.revision === 'number' ? afterData.revision : undefined;
  const beforeRevision = typeof beforeData?.revision === 'number' ? beforeData.revision : undefined;
  if (
    afterRevision !== undefined &&
    beforeRevision !== undefined &&
    afterRevision > beforeRevision
  ) {
    return;
  }

  const manifestRef = db.doc(MANIFEST_PATH);

  await db.runTransaction(async (tx) => {
    const manifestSnap = await tx.get(manifestRef);
    const manifest = manifestSnap.data() as Record<string, unknown> | undefined;
    const currentRevision =
      typeof manifest?.aislesRevision === 'number' ? manifest.aislesRevision : 0;
    const newRevision = currentRevision + 1;
    const now = Timestamp.now();

    tx.set(
      manifestRef,
      {
        aislesRevision: newRevision,
        latestAislesUpdatedAt: now,
        latestRevisionAt: now,
      },
      { merge: true },
    );

    if (afterData !== undefined && afterRef !== undefined) {
      tx.update(afterRef, {
        revision: newRevision,
        updatedAt: now.toDate().toISOString(),
      });
    }

    logger.info('canon manifest incremented', {
      scope: 'aisles',
      newRevision,
      docId: AISLES_DOC_PATH,
    });
  });
}

export const onAislesWritten = onDocumentWritten('canonData/aisles', async (event) => {
  const db = getFirestore();
  const beforeData = event.data?.before?.data() as Record<string, unknown> | undefined;
  const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
  const afterRef = event.data?.after?.ref as DocumentReference | undefined;

  try {
    await handleAislesWritten(db, beforeData, afterData, afterRef);
  } catch (err) {
    logger.error('onAislesWritten failed', {
      scope: 'aisles',
      docId: AISLES_DOC_PATH,
      errorCategory: classifyAdminFirestoreError(err),
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});
