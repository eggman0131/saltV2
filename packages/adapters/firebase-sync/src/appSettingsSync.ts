import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { AppSettingsSchema, type AppSettings } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Admin-managed AI model settings (Phase 1). A single Firestore singleton doc,
// read here for the admin UI and (independently, via the Admin SDK) by the CF
// model resolver. A corrupt doc surfaces a Failure via onError (single-doc read
// contract); a missing doc yields null (the UI/resolver apply schema defaults).

const COLLECTION = 'appSettings';
const SINGLETON_DOC_ID = 'singleton';

export function subscribeAppSettings(
  onSettings: (settings: AppSettings | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, COLLECTION, SINGLETON_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onSettings(null);
        return;
      }
      const result = AppSettingsSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onSettings(result.data);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function saveAppSettings(
  settings: AppSettings,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, SINGLETON_DOC_ID), { ...settings });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
