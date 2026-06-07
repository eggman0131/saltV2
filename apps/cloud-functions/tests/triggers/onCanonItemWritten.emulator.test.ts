/**
 * Emulator integration test for onCanonItemWritten (issue #148, Phase 3).
 *
 * Exercises the two independently-guarded side-effects against the real
 * Firestore emulator. The AI flows, sharp processing and Storage upload are
 * mocked (the isolated Vitest stack runs Firestore + Auth only — no Storage,
 * no real Gemini), so the test focuses on the guard logic and the Firestore
 * writeback: a null thumbnail gets a generated icon URL, a "hidden" thumbnail
 * is left untouched, and an existing icon URL is not regenerated.
 *
 * Run via: pnpm test:emulator
 */

process.env['FIRESTORE_EMULATOR_HOST'] =
  `127.0.0.1:${process.env['VITE_EMULATOR_FIRESTORE_PORT'] ?? '8080'}`;

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { CanonItemDoc } from '@salt/domain/schemas';

// ─── Mocks (everything except firebase-admin/firestore) ──────────────────────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => '' }),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockEmbed = vi.fn(async () => ({ values: [0.1, 0.2, 0.3] }));
vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: mockEmbed }));

const mockGenerateIcon = vi.fn(async () => ({ imageBase64: 'QUJD', contentType: 'image/png' }));
vi.mock('../../src/flows/generateCanonIcon.js', () => ({
  generateCanonIconFlow: mockGenerateIcon,
}));

const mockRemoveBg = vi.fn(async () => Buffer.from([1, 2, 3]));
vi.mock('../../src/imaging/removeFlatBackground.js', () => ({
  removeFlatBackground: mockRemoveBg,
}));

const mockSave = vi.fn(async () => undefined);
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      name: 'demo-salt.appspot.com',
      file: (path: string) => {
        void path;
        return { save: mockSave };
      },
    }),
  }),
}));

const { onCanonItemWritten } = await import('../../src/triggers/onCanonItemWritten.js');

// ─── Setup ───────────────────────────────────────────────────────────────────

const PROJECT_ID = 'demo-salt';
const EMULATOR_HOST = process.env['FIRESTORE_EMULATOR_HOST'] as string;

let adminApp: App;

function makeCanonItem(id: string, overrides: Partial<CanonItemDoc> = {}): CanonItemDoc {
  return {
    id,
    schemaVersion: 5,
    name: 'Baked Beans',
    synonyms: [],
    aisleId: 'tinned',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function clearEmulator(): Promise<void> {
  const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Failed to clear emulator: HTTP ${resp.status}`);
  }
}

function makeEvent(id: string, after: CanonItemDoc | null) {
  return {
    params: { id },
    data: {
      before: { exists: false, data: () => undefined },
      after: after ? { exists: true, data: () => after } : { exists: false, data: () => undefined },
    },
  };
}

beforeAll(() => {
  adminApp = initializeApp({ projectId: PROJECT_ID });
});

afterAll(async () => {
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await clearEmulator();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('onCanonItemWritten — Firestore emulator', () => {
  it('generates an icon and writes its public URL to thumbnail when null', async () => {
    const db = getFirestore(adminApp);
    const item = makeCanonItem('canon-1', { thumbnail: null });
    await db.collection('canonItems').doc('canon-1').set(item);

    await (onCanonItemWritten as Function)(makeEvent('canon-1', item));

    expect(mockGenerateIcon).toHaveBeenCalledOnce();
    expect(mockRemoveBg).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledOnce();

    const snap = await db.collection('canonItems').doc('canon-1').get();
    expect(snap.data()!['thumbnail']).toBe(
      'https://firebasestorage.googleapis.com/v0/b/demo-salt.appspot.com/o/canon-icons%2Fcanon-1.webp?alt=media',
    );
    // Embedding branch also ran.
    expect(snap.data()!['embedding']).toEqual([0.1, 0.2, 0.3]);
  });

  it('passes a one-shot iconHint to the flow and clears it after success', async () => {
    const db = getFirestore(adminApp);
    const item = makeCanonItem('canon-hint', { thumbnail: null, iconHint: 'show it as a tin' });
    await db.collection('canonItems').doc('canon-hint').set(item);

    await (onCanonItemWritten as Function)(makeEvent('canon-hint', item));

    expect(mockGenerateIcon).toHaveBeenCalledWith({
      name: 'Baked Beans',
      hint: 'show it as a tin',
    });

    const snap = await db.collection('canonItems').doc('canon-hint').get();
    expect(snap.data()!['thumbnail']).toContain('canon-icons%2Fcanon-hint.webp');
    // The one-shot hint is cleared.
    expect(snap.data()!['iconHint']).toBeUndefined();
  });

  it('skips icon generation when thumbnail is "hidden"', async () => {
    const db = getFirestore(adminApp);
    const item = makeCanonItem('canon-2', { thumbnail: 'hidden', embedding: [9, 9] });
    await db.collection('canonItems').doc('canon-2').set(item);

    await (onCanonItemWritten as Function)(makeEvent('canon-2', item));

    expect(mockGenerateIcon).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();

    const snap = await db.collection('canonItems').doc('canon-2').get();
    expect(snap.data()!['thumbnail']).toBe('hidden');
  });

  it('does not regenerate when thumbnail is already a URL', async () => {
    const db = getFirestore(adminApp);
    const existing =
      'https://storage.googleapis.com/demo-salt.appspot.com/canon-icons/canon-3.webp';
    const item = makeCanonItem('canon-3', { thumbnail: existing, embedding: [1] });
    await db.collection('canonItems').doc('canon-3').set(item);

    await (onCanonItemWritten as Function)(makeEvent('canon-3', item));

    expect(mockGenerateIcon).not.toHaveBeenCalled();
    const snap = await db.collection('canonItems').doc('canon-3').get();
    expect(snap.data()!['thumbnail']).toBe(existing);
  });

  it('skips the embedding branch when an embedding already exists', async () => {
    const db = getFirestore(adminApp);
    const item = makeCanonItem('canon-4', { thumbnail: 'hidden', embedding: [0.5] });
    await db.collection('canonItems').doc('canon-4').set(item);

    await (onCanonItemWritten as Function)(makeEvent('canon-4', item));

    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
