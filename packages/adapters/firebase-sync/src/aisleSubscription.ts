import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { Aisle } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { AislesDocumentSchema } from '@salt/domain/schemas';
import { subscribeDocument } from './subscribeDocument.js';

const AISLES_COLLECTION = 'canonData';
const AISLES_DOC_ID = 'aisles';

export function subscribeAisles(
  onAisles: (aisles: Aisle[]) => void,
  // rawError forwards the original Firestore error for the real stack; the
  // synthetic schema-corruption DomainError has none, so the parse path omits
  // it (see subscribeDocument.ts).
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeDocument(
    {
      path: [AISLES_COLLECTION, AISLES_DOC_ID],
      schema: AislesDocumentSchema,
      label: 'AislesDocumentSchema',
      onCorrupt: 'error',
      logsRejection: false,
      forwardsRawError: true,
    },
    // ONE document holding the whole array, so "no document" is an empty list
    // rather than the `null` every other single-document read delivers — there
    // is no such thing as "no aisles yet", only none of them.
    (document) => onAisles(document === null ? [] : document.aisles),
    onError,
  );
}

export async function saveAisles(aisles: Aisle[]): Promise<void> {
  const db = getFirestore(getApp());
  await setDoc(doc(db, AISLES_COLLECTION, AISLES_DOC_ID), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    aisles: [...aisles],
  });
}
