import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const MANIFEST_PATH = 'canonManifest/global';

// Only the CF ever increases revision; afterRevision > beforeRevision means
// this is a re-trigger from our own stamp write — skip to avoid an infinite loop.
export async function handleCanonItemWritten(
  db: Firestore,
  docId: string,
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
      typeof manifest?.itemsRevision === 'number' ? manifest.itemsRevision : 0;
    const newRevision = currentRevision + 1;
    const now = Timestamp.now();

    tx.set(
      manifestRef,
      {
        itemsRevision: newRevision,
        latestItemsUpdatedAt: now,
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

    logger.info('canon manifest incremented', { scope: 'items', newRevision, docId });
  });
}

export const onCanonItemWritten = onDocumentWritten('canonItems/{id}', async (event) => {
  const db = getFirestore();
  const docId = event.params.id;
  const beforeData = event.data?.before?.data() as Record<string, unknown> | undefined;
  const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
  const afterRef = event.data?.after?.ref as DocumentReference | undefined;

  try {
    await handleCanonItemWritten(db, docId, beforeData, afterData, afterRef);
  } catch (err) {
    logger.error('onCanonItemWritten failed', { docId, err });
    throw err;
  }
});
