/**
 * Firestore emulator integration tests for firebaseAisleSync.
 *
 * Requires the Firestore emulator running at 127.0.0.1:8080.
 * Run via: pnpm test:emulator (uses firebase emulators:exec).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { initFirebase } from '../src/init.js';
import { createFirebaseAisleSyncTransportAdapter } from '../src/firebaseAisleSync.js';
import { clearFirestoreEmulator, PROJECT_ID } from './emulatorHelpers.js';
import type { Aisle } from '@salt/domain';

const AISLES_PATH = 'canonData/aisles';

function makeAisle(id: string, name: string): Aisle {
  return { id, name, order: 0 };
}

function aislesDoc(aisles: Aisle[], revision: number) {
  return {
    schemaVersion: 1,
    revision,
    updatedAt: '2026-05-01T00:00:00.000Z',
    aisles,
  };
}

beforeAll(() => {
  initFirebase({ projectId: PROJECT_ID }, true);
});

beforeEach(async () => {
  await clearFirestoreEmulator();
});

describe('firebaseAisleSync — Firestore emulator', () => {
  describe('pull', () => {
    it('returns null when the aisles document does not exist', async () => {
      const adapter = createFirebaseAisleSyncTransportAdapter();
      const result = await adapter.pull(null);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value).toBeNull();
    });

    it('returns the full document when sinceCursor is null', async () => {
      const db = getFirestore();
      const aisles = [makeAisle('a1', 'Produce'), makeAisle('a2', 'Dairy')];
      await setDoc(doc(db, AISLES_PATH), aislesDoc(aisles, 4));

      const adapter = createFirebaseAisleSyncTransportAdapter();
      const result = await adapter.pull(null);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value).not.toBeNull();
      expect(result.value!.aisles).toHaveLength(2);
      expect(result.value!.cursor).toBe(4);
    });

    it('returns the document when revision > sinceCursor', async () => {
      const db = getFirestore();
      await setDoc(doc(db, AISLES_PATH), aislesDoc([makeAisle('a1', 'Produce')], 6));

      const adapter = createFirebaseAisleSyncTransportAdapter();
      const result = await adapter.pull(3);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value).not.toBeNull();
      expect(result.value!.cursor).toBe(6);
    });

    it('returns null (no-op) when revision <= sinceCursor', async () => {
      const db = getFirestore();
      await setDoc(doc(db, AISLES_PATH), aislesDoc([makeAisle('a1', 'Produce')], 3));

      const adapter = createFirebaseAisleSyncTransportAdapter();
      const result = await adapter.pull(3);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.value).toBeNull();
    });
  });

  describe('push', () => {
    it('creates the aisles document when it does not exist', async () => {
      const db = getFirestore();
      const aisles = [makeAisle('a1', 'Meat')];
      const adapter = createFirebaseAisleSyncTransportAdapter();
      const result = await adapter.push(aisles, 0);

      expect(result.kind).toBe('ok');
      const snap = await getDoc(doc(db, AISLES_PATH));
      expect(snap.exists()).toBe(true);
      expect(snap.data()!['aisles']).toHaveLength(1);
    });

    it('updates the document when base revision matches remote', async () => {
      const db = getFirestore();
      await setDoc(doc(db, AISLES_PATH), aislesDoc([makeAisle('a1', 'Old')], 2));

      const adapter = createFirebaseAisleSyncTransportAdapter();
      const result = await adapter.push([makeAisle('a1', 'New')], 2);

      expect(result.kind).toBe('ok');
      const snap = await getDoc(doc(db, AISLES_PATH));
      expect(snap.data()!['aisles'][0].name).toBe('New');
    });

    it('returns conflict when remote revision != base revision', async () => {
      const db = getFirestore();
      await setDoc(doc(db, AISLES_PATH), aislesDoc([makeAisle('a1', 'Remote')], 8));

      const adapter = createFirebaseAisleSyncTransportAdapter();
      const result = await adapter.push([makeAisle('a1', 'Local')], 3);

      expect(result.kind).toBe('conflict');
    });

    it('does not overwrite when conflict detected', async () => {
      const db = getFirestore();
      await setDoc(doc(db, AISLES_PATH), aislesDoc([makeAisle('a1', 'Remote')], 5));

      const adapter = createFirebaseAisleSyncTransportAdapter();
      await adapter.push([makeAisle('a1', 'Should Not Win')], 2);

      const snap = await getDoc(doc(db, AISLES_PATH));
      expect(snap.data()!['aisles'][0].name).toBe('Remote');
    });
  });
});
