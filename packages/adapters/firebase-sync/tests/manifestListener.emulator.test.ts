/**
 * Firestore emulator integration tests for createFirebaseManifestListener.
 *
 * Requires the Firestore emulator running at 127.0.0.1:8080.
 * Run via: pnpm test:emulator (uses firebase emulators:exec).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, getFirestore, setDoc, updateDoc } from 'firebase/firestore';
import { createFirebaseManifestListener } from '../src/firebaseManifestListener.js';
import { clearFirestoreEmulator, initFirebaseEmulator } from './emulatorHelpers.js';

const MANIFEST_PATH = 'canonManifest/global';

function waitForTick(onTick: ReturnType<typeof vi.fn>, count = 1, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`Timed out waiting for ${count} manifest tick(s)`)),
      timeout,
    );
    const interval = setInterval(() => {
      if (onTick.mock.calls.length >= count) {
        clearTimeout(id);
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

beforeAll(async () => {
  await initFirebaseEmulator();
});

beforeEach(async () => {
  await clearFirestoreEmulator();
});

const unsubscribes: Array<() => void> = [];
afterEach(() => {
  for (const unsub of unsubscribes) unsub();
  unsubscribes.length = 0;
});

describe('createFirebaseManifestListener — Firestore emulator', () => {
  it('emits a tick when the manifest document is created', async () => {
    const onTick = vi.fn();
    const onError = vi.fn();

    const unsub = createFirebaseManifestListener(onTick, onError);
    unsubscribes.push(unsub);

    const db = getFirestore();
    await setDoc(doc(db, MANIFEST_PATH), {
      itemsRevision: 3,
      aislesRevision: 1,
    });

    await waitForTick(onTick);

    expect(onTick).toHaveBeenCalledWith(
      expect.objectContaining({ itemsRevision: 3, aislesRevision: 1 }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it('emits updated revisions on each manifest write', async () => {
    const db = getFirestore();
    await setDoc(doc(db, MANIFEST_PATH), { itemsRevision: 1, aislesRevision: 0 });

    const onTick = vi.fn();
    const unsub = createFirebaseManifestListener(onTick, vi.fn());
    unsubscribes.push(unsub);

    // Wait for the initial tick from existing document.
    await waitForTick(onTick, 1);

    // Advance itemsRevision.
    await updateDoc(doc(db, MANIFEST_PATH), { itemsRevision: 2 });
    await waitForTick(onTick, 2);

    const lastCall = onTick.mock.calls.at(-1)![0] as { itemsRevision: number };
    expect(lastCall.itemsRevision).toBe(2);
  });

  it('defaults missing revision fields to 0', async () => {
    const db = getFirestore();
    await setDoc(doc(db, MANIFEST_PATH), { itemsRevision: 5 }); // aislesRevision absent

    const onTick = vi.fn();
    const unsub = createFirebaseManifestListener(onTick, vi.fn());
    unsubscribes.push(unsub);

    await waitForTick(onTick);

    expect(onTick).toHaveBeenCalledWith(
      expect.objectContaining({ itemsRevision: 5, aislesRevision: 0 }),
    );
  });

  it('does not emit when the manifest document does not exist', async () => {
    const onTick = vi.fn();
    const unsub = createFirebaseManifestListener(onTick, vi.fn());
    unsubscribes.push(unsub);

    // Wait briefly — no document, so onSnapshot fires with empty (no call expected).
    await new Promise((r) => setTimeout(r, 200));
    expect(onTick).not.toHaveBeenCalled();
  });

  it('returns a working unsubscribe function', async () => {
    const db = getFirestore();
    const onTick = vi.fn();
    const unsub = createFirebaseManifestListener(onTick, vi.fn());
    // Don't push to unsubscribes — we call it manually below.

    await setDoc(doc(db, MANIFEST_PATH), { itemsRevision: 1, aislesRevision: 0 });
    await waitForTick(onTick, 1);

    unsub();

    const callCount = onTick.mock.calls.length;
    await updateDoc(doc(db, MANIFEST_PATH), { itemsRevision: 2 });
    await new Promise((r) => setTimeout(r, 200));

    // No new calls after unsubscribe.
    expect(onTick.mock.calls.length).toBe(callCount);
  });
});
