/**
 * Firestore emulator integration tests for firebaseCanonSyncTransport.
 *
 * Requires the Firestore emulator running at 127.0.0.1:8080.
 * Run via: pnpm test:emulator (uses firebase emulators:exec).
 *
 * These tests are additive — the mock-based unit tests in
 * firebaseCanonSyncTransport.test.ts are the fast-feedback layer.
 * These tests verify the real Firestore query/transaction semantics.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { initFirebase } from '../src/init.js';
import { createFirebaseCanonSyncTransportAdapter } from '../src/firebaseCanonSyncTransport.js';
import { clearFirestoreEmulator, PROJECT_ID } from './emulatorHelpers.js';

function makeItem(id: string, revision: number, name = 'Test Item') {
  return {
    id,
    name,
    synonyms: [] as string[],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    revision,
    deletedAt: null,
    schemaVersion: 2,
  };
}

beforeAll(() => {
  initFirebase({ projectId: PROJECT_ID }, true);
});

beforeEach(async () => {
  await clearFirestoreEmulator();
});

describe('firebaseCanonSyncTransport — Firestore emulator', () => {
  describe('pull', () => {
    it('returns empty batch when no items exist', async () => {
      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.pull(null);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value.upserted).toHaveLength(0);
      expect(result.value.cursor).toBe(0);
    });

    it('returns all items when sinceCursor is null', async () => {
      const db = getFirestore();
      await setDoc(doc(db, 'canonItems', 'a'), makeItem('a', 1, 'Salt'));
      await setDoc(doc(db, 'canonItems', 'b'), makeItem('b', 3, 'Pepper'));

      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.pull(null);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value.upserted).toHaveLength(2);
      expect(result.value.cursor).toBe(3);
    });

    it('delta pull returns only items with revision > sinceCursor', async () => {
      const db = getFirestore();
      await setDoc(doc(db, 'canonItems', 'old'), makeItem('old', 2, 'Old'));
      await setDoc(doc(db, 'canonItems', 'new'), makeItem('new', 7, 'New'));

      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.pull(4);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value.upserted).toHaveLength(1);
      expect(result.value.upserted[0]!.id).toBe('new');
      expect(result.value.cursor).toBe(7);
    });

    it('preserves cursor when no new items exist since sinceCursor', async () => {
      const db = getFirestore();
      await setDoc(doc(db, 'canonItems', 'a'), makeItem('a', 2));

      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.pull(5);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value.upserted).toHaveLength(0);
      expect(result.value.cursor).toBe(5);
    });

    it('includes tombstoned items (deletedAt set) in the batch', async () => {
      const db = getFirestore();
      await setDoc(doc(db, 'canonItems', 'gone'), {
        ...makeItem('gone', 4),
        deletedAt: '2026-05-01T00:00:00.000Z',
      });

      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.pull(null);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value.upserted).toHaveLength(1);
      expect(result.value.upserted[0]!.deletedAt).not.toBeNull();
    });
  });

  describe('push', () => {
    it('writes a new item to Firestore', async () => {
      const db = getFirestore();
      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.push(makeItem('push-new', 0, 'Garlic'));

      expect(result.kind).toBe('ok');
      const snap = await getDoc(doc(db, 'canonItems', 'push-new'));
      expect(snap.exists()).toBe(true);
      expect(snap.data()!['name']).toBe('Garlic');
    });

    it('updates an existing item when revisions match', async () => {
      const db = getFirestore();
      await setDoc(doc(db, 'canonItems', 'upd'), makeItem('upd', 2, 'Original'));

      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.push(makeItem('upd', 2, 'Updated'));

      expect(result.kind).toBe('ok');
      const snap = await getDoc(doc(db, 'canonItems', 'upd'));
      expect(snap.data()!['name']).toBe('Updated');
    });

    it('returns conflict when remote revision != local revision', async () => {
      const db = getFirestore();
      // Remote is at revision 5; local thinks it's at 2
      await setDoc(doc(db, 'canonItems', 'clash'), makeItem('clash', 5, 'Remote'));

      const adapter = createFirebaseCanonSyncTransportAdapter();
      const result = await adapter.push(makeItem('clash', 2, 'Local'));

      expect(result.kind).toBe('conflict');
      if (result.kind !== 'conflict') return;
      expect(result.remote.id).toBe('clash');
    });

    it('does not overwrite Firestore when conflict is detected', async () => {
      const db = getFirestore();
      await setDoc(doc(db, 'canonItems', 'safe'), makeItem('safe', 9, 'Remote'));

      const adapter = createFirebaseCanonSyncTransportAdapter();
      await adapter.push(makeItem('safe', 3, 'Should Not Win'));

      const snap = await getDoc(doc(db, 'canonItems', 'safe'));
      expect(snap.data()!['name']).toBe('Remote');
    });
  });
});
