import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { DevSettingsSchema, type DevSettingsDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Per-environment developer settings (issue #238). A single Firestore singleton
// doc, read here for the admin UI and by the onCanonItemWritten CF trigger. A
// corrupt doc surfaces a Failure via onError (single-doc read contract); a
// missing doc yields null (the UI/trigger apply the enabled-by-default fallback).

const COLLECTION = 'devSettings';
const SINGLETON_DOC_ID = 'singleton';

export function subscribeDevSettings(
  onSettings: (settings: DevSettingsDoc | null) => void,
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
      const result = DevSettingsSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onSettings(result.data);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export async function saveDevSettings(
  settings: DevSettingsDoc,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, COLLECTION, SINGLETON_DOC_ID), { ...settings });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
