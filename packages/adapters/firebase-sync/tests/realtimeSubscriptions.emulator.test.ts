/**
 * Firestore emulator integration tests for real-time subscription primitives.
 *
 * Proves that a write on one client (named "writer" app) lands in another
 * client's (default app) subscription callback within the convergence window.
 *
 * Requires the Firestore emulator running at 127.0.0.1:8080.
 * Run via: pnpm test:emulator
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { subscribeCanonItems, upsertCanonItem } from '../src/canonSubscription.js';
import { subscribeAisles, saveAisles } from '../src/aisleSubscription.js';
import { clearFirestoreEmulator, initFirebaseEmulator, PROJECT_ID } from './emulatorHelpers.js';
import type { CanonItem, Aisle } from '@salt/domain';

const CONVERGENCE_MS = 5000;

let writerApp: FirebaseApp;
let writerDb: Firestore;

function makeItem(id: string, name = 'Test'): CanonItem {
  return {
    id,
    schemaVersion: 2,
    name,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    revision: 0,
    deletedAt: null,
  };
}

function makeAisle(id: string, name: string): Aisle {
  return { id, name, order: 0 };
}

beforeAll(async () => {
  await initFirebaseEmulator();

  writerApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-api-key' }, 'rt-writer');
  writerDb = getFirestore(writerApp);
  connectFirestoreEmulator(writerDb, '127.0.0.1', 8080);
  const writerAuth = getAuth(writerApp);
  connectAuthEmulator(writerAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInAnonymously(writerAuth);
});

afterAll(async () => {
  await deleteApp(writerApp);
});

beforeEach(async () => {
  await clearFirestoreEmulator();
});

describe('realtimeSubscriptions — Firestore emulator', () => {
  describe('subscribeCanonItems', () => {
    it('delivers a cross-client write within the convergence window', async () => {
      const received: CanonItem[][] = [];
      const unsubscribe = subscribeCanonItems(
        (items) => received.push(items),
        () => {},
      );

      await setDoc(doc(writerDb, 'canonItems', 'carrot'), makeItem('carrot', 'Carrot'));

      await waitFor(
        () => received.some((items) => items.some((i) => i.id === 'carrot')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((items) => items.some((i) => i.id === 'carrot'))).toBe(true);
    });

    it('delivers items written via upsertCanonItem', async () => {
      const received: CanonItem[][] = [];
      const unsubscribe = subscribeCanonItems(
        (items) => received.push(items),
        () => {},
      );

      await upsertCanonItem(makeItem('onion', 'Onion'));

      await waitFor(
        () => received.some((items) => items.some((i) => i.id === 'onion')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((items) => items.some((i) => i.id === 'onion'))).toBe(true);
    });

    it('returns the unsubscribe function that stops callbacks', async () => {
      const received: CanonItem[][] = [];
      const unsubscribe = subscribeCanonItems(
        (items) => received.push(items),
        () => {},
      );

      // Wait for initial snapshot to settle
      await waitFor(() => received.length > 0, CONVERGENCE_MS);
      const countBeforeUnsub = received.length;
      unsubscribe();

      // Write after unsubscribe — callback must not fire
      await setDoc(doc(writerDb, 'canonItems', 'after'), makeItem('after', 'After'));
      await delay(500);

      expect(received.length).toBe(countBeforeUnsub);
    });
  });

  describe('subscribeAisles', () => {
    it('delivers a cross-client write within the convergence window', async () => {
      const received: Aisle[][] = [];
      const unsubscribe = subscribeAisles(
        (aisles) => received.push(aisles),
        () => {},
      );

      await setDoc(doc(writerDb, 'canonData', 'aisles'), {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        aisles: [{ id: 'produce', name: 'Produce', order: 0 }],
      });

      await waitFor(
        () => received.some((aisles) => aisles.some((a) => a.id === 'produce')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((aisles) => aisles.some((a) => a.id === 'produce'))).toBe(true);
    });

    it('delivers aisles written via saveAisles', async () => {
      const received: Aisle[][] = [];
      const unsubscribe = subscribeAisles(
        (aisles) => received.push(aisles),
        () => {},
      );

      await saveAisles([makeAisle('meat', 'Meat & Seafood')]);

      await waitFor(
        () => received.some((aisles) => aisles.some((a) => a.id === 'meat')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((aisles) => aisles.some((a) => a.id === 'meat'))).toBe(true);
    });

    it('delivers empty array when document does not exist', async () => {
      const received: Aisle[][] = [];
      const unsubscribe = subscribeAisles(
        (aisles) => received.push(aisles),
        () => {},
      );

      // Firestore may deliver a stale cache snapshot first; wait for the
      // server-confirmed empty delivery.
      await waitFor(() => received.some((r) => r.length === 0), CONVERGENCE_MS);

      unsubscribe();
      expect(received.some((r) => r.length === 0)).toBe(true);
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await delay(50);
  }
}
