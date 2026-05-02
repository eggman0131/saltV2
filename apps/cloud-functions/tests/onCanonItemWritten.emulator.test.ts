/**
 * Firestore emulator integration tests for handleCanonItemWritten.
 *
 * Calls the exported handler directly with a real admin Firestore DB
 * pointed at the emulator. Verifies the transaction atomically increments
 * itemsRevision and stamps revision/updatedAt back to the item document.
 *
 * Requires the Firestore emulator running at 127.0.0.1:8080.
 * The FIRESTORE_EMULATOR_HOST env var is set automatically by
 * firebase emulators:exec.
 *
 * firebase-functions/v2/firestore and firebase-functions/logger are still
 * mocked — we're testing the Firestore transaction semantics only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: vi.fn(() => () => {}),
}));
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { handleCanonItemWritten } from '../src/triggers/onCanonItemWritten.js';

const PROJECT_ID = 'demo-salt';
const MANIFEST_PATH = 'canonManifest/global';
const EMULATOR_HOST = '127.0.0.1:8080';

async function clearEmulator(): Promise<void> {
  const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Failed to clear emulator: HTTP ${resp.status}`);
  }
}

let db: ReturnType<typeof getFirestore>;

beforeAll(() => {
  process.env['FIRESTORE_EMULATOR_HOST'] = EMULATOR_HOST;
  const app = getApps().length > 0 ? getApp() : initializeApp({ projectId: PROJECT_ID });
  db = getFirestore(app);
});

beforeEach(async () => {
  await clearEmulator();
});

describe('handleCanonItemWritten — Firestore emulator', () => {
  it('increments itemsRevision in the manifest', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 5, aislesRevision: 2 });
    const afterRef = db.doc('canonItems/item-1');
    await afterRef.set({ id: 'item-1', name: 'Salt', revision: 0 });

    await handleCanonItemWritten(db, 'item-1', undefined, { revision: 0 }, afterRef);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.data()!['itemsRevision']).toBe(6);
    // aislesRevision must be untouched
    expect(manifest.data()!['aislesRevision']).toBe(2);
  });

  it('creates the manifest document when it does not exist', async () => {
    const afterRef = db.doc('canonItems/new-item');
    await afterRef.set({ id: 'new-item', name: 'Pepper', revision: 0 });

    await handleCanonItemWritten(db, 'new-item', undefined, { revision: 0 }, afterRef);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.exists).toBe(true);
    expect(manifest.data()!['itemsRevision']).toBe(1);
  });

  it('stamps revision and updatedAt onto the item document', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 3, aislesRevision: 0 });
    const afterRef = db.doc('canonItems/stamp-me');
    await afterRef.set({ id: 'stamp-me', revision: 0 });

    await handleCanonItemWritten(db, 'stamp-me', undefined, { revision: 0 }, afterRef);

    const item = await afterRef.get();
    expect(item.data()!['revision']).toBe(4);
    expect(typeof item.data()!['updatedAt']).toBe('string');
  });

  it('skips (idempotency) when afterRevision > beforeRevision', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 10, aislesRevision: 0 });

    // afterRevision (5) > beforeRevision (3) → this is a CF re-trigger, skip.
    await handleCanonItemWritten(db, 'idempotent', { revision: 3 }, { revision: 5 }, undefined);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.data()!['itemsRevision']).toBe(10); // unchanged
  });

  it('advances revision exactly once per write (no double-increment)', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 0, aislesRevision: 0 });
    const afterRef = db.doc('canonItems/once');
    await afterRef.set({ id: 'once', revision: 0 });

    await handleCanonItemWritten(db, 'once', undefined, { revision: 0 }, afterRef);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.data()!['itemsRevision']).toBe(1);
  });

  it('does not touch aislesRevision (cross-scope isolation)', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 0, aislesRevision: 7 });
    const afterRef = db.doc('canonItems/iso');
    await afterRef.set({ id: 'iso', revision: 0 });

    await handleCanonItemWritten(db, 'iso', undefined, { revision: 0 }, afterRef);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.data()!['aislesRevision']).toBe(7);
    expect(manifest.data()!['itemsRevision']).toBe(1);
  });
});
