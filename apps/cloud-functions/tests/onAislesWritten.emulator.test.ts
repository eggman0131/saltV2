/**
 * Firestore emulator integration tests for handleAislesWritten.
 *
 * Calls the exported handler directly with a real admin Firestore DB.
 * Verifies the transaction atomically increments aislesRevision and stamps
 * revision/updatedAt onto the canonData/aisles wrapper document.
 *
 * Requires the Firestore emulator running at 127.0.0.1:8080.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: vi.fn(() => () => {}),
}));
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { handleAislesWritten } from '../src/triggers/onAislesWritten.js';

const PROJECT_ID = 'demo-salt';
const MANIFEST_PATH = 'canonManifest/global';
const AISLES_PATH = 'canonData/aisles';
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

describe('handleAislesWritten — Firestore emulator', () => {
  it('increments aislesRevision in the manifest', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 4, aislesRevision: 2 });
    const afterRef = db.doc(AISLES_PATH);
    await afterRef.set({ aisles: [], revision: 0 });

    await handleAislesWritten(db, undefined, { revision: 0 }, afterRef);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.data()!['aislesRevision']).toBe(3);
    // itemsRevision must be untouched
    expect(manifest.data()!['itemsRevision']).toBe(4);
  });

  it('creates the manifest document when it does not exist', async () => {
    const afterRef = db.doc(AISLES_PATH);
    await afterRef.set({ aisles: [], revision: 0 });

    await handleAislesWritten(db, undefined, { revision: 0 }, afterRef);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.exists).toBe(true);
    expect(manifest.data()!['aislesRevision']).toBe(1);
  });

  it('stamps revision and updatedAt onto the aisles document', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 0, aislesRevision: 1 });
    const afterRef = db.doc(AISLES_PATH);
    await afterRef.set({ aisles: [], revision: 0 });

    await handleAislesWritten(db, undefined, { revision: 0 }, afterRef);

    const snap = await afterRef.get();
    expect(snap.data()!['revision']).toBe(2);
    expect(typeof snap.data()!['updatedAt']).toBe('string');
  });

  it('skips (idempotency) when afterRevision > beforeRevision', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 0, aislesRevision: 10 });

    // CF re-trigger from its own stamp write → skip.
    await handleAislesWritten(db, { revision: 1 }, { revision: 3 }, undefined);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.data()!['aislesRevision']).toBe(10); // unchanged
  });

  it('does not touch itemsRevision (cross-scope isolation)', async () => {
    await db.doc(MANIFEST_PATH).set({ itemsRevision: 5, aislesRevision: 0 });
    const afterRef = db.doc(AISLES_PATH);
    await afterRef.set({ aisles: [], revision: 0 });

    await handleAislesWritten(db, undefined, { revision: 0 }, afterRef);

    const manifest = await db.doc(MANIFEST_PATH).get();
    expect(manifest.data()!['itemsRevision']).toBe(5);
    expect(manifest.data()!['aislesRevision']).toBe(1);
  });
});
