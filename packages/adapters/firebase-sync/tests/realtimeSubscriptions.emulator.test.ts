/**
 * Firestore emulator integration tests for real-time subscription primitives.
 *
 * Proves that a write on one client (named "writer" app) lands in another
 * client's (default app) subscription callback within the convergence window.
 *
 * Requires the isolated Vitest emulator stack (issue #84 Phase 3); ports come
 * from this package's .env.test via import.meta.env, with the dev emulator
 * (8080/9099) as the ad-hoc fallback.
 * Run via: pnpm test:emulator
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { subscribeCanonItems, upsertCanonItem, deleteCanonItem } from '../src/canonSubscription.js';
import { subscribeAisles, saveAisles } from '../src/aisleSubscription.js';
import {
  subscribeEquipmentManifest,
  saveEquipmentManifest,
} from '../src/equipmentManifestSubscription.js';
import { subscribeShoppingLists, createShoppingList } from '../src/shoppingListSubscription.js';
import {
  subscribeShoppingListItems,
  saveShoppingListItem,
} from '../src/shoppingListItemSubscription.js';
import {
  subscribeShoppingListsConfig,
  saveShoppingListsConfig,
} from '../src/shoppingListsConfigSubscription.js';
import { clearFirestoreEmulator, initFirebaseEmulator, PROJECT_ID } from './emulatorHelpers.js';
import type {
  CanonItem,
  Aisle,
  EquipmentManifest,
  EquipmentItem,
  ShoppingList,
  ShoppingListItem,
  ShoppingListsConfig,
} from '@salt/domain';

// Cross-client onSnapshot propagation tolerance. Generous to absorb cold-start
// latency on CI's Dockerized emulator (the first subscription in each block and
// the server-confirmed-empty delivery can take several seconds there). waitFor
// polls and resolves the instant data converges, so this only raises the
// failure ceiling — warm local runs stay sub-second. Kept below the Vitest
// testTimeout in vitest.emulator.config.ts so waitFor surfaces its own clearer
// error rather than being pre-empted by Vitest's per-test timeout.
const CONVERGENCE_MS = 15_000;

// The "writer" app connects to the emulator directly (it does not go through
// init.ts), so resolve the isolated Vitest stack ports from the same source
// init.ts/auth.ts/emulatorHelpers.ts use — .env.test → import.meta.env — so
// the writer and the default app always hit the same emulator (issue #84
// Phase 3). Dev ports stay as the ad-hoc fallback.
const _env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const WRITER_FIRESTORE_PORT = Number(_env['VITE_EMULATOR_FIRESTORE_PORT'] ?? 8080);
const WRITER_AUTH_PORT = _env['VITE_EMULATOR_AUTH_PORT'] ?? '9099';

let writerApp: FirebaseApp;
let writerDb: Firestore;

function makeItem(id: string, name = 'Test'): CanonItem {
  return {
    id,
    schemaVersion: 5,
    name,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
  };
}

function makeAisle(id: string, name: string): Aisle {
  return { id, name, order: 0 };
}

beforeAll(async () => {
  await initFirebaseEmulator();

  writerApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-api-key' }, 'rt-writer');
  writerDb = getFirestore(writerApp);
  connectFirestoreEmulator(writerDb, '127.0.0.1', WRITER_FIRESTORE_PORT);
  const writerAuth = getAuth(writerApp);
  connectAuthEmulator(writerAuth, `http://127.0.0.1:${WRITER_AUTH_PORT}`, {
    disableWarnings: true,
  });
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

    it('deleteCanonItem removes the doc and the deletion converges via onSnapshot', async () => {
      const received: CanonItem[][] = [];
      const unsubscribe = subscribeCanonItems(
        (items) => received.push(items),
        () => {},
      );

      await upsertCanonItem(makeItem('garlic', 'Garlic'));
      await waitFor(
        () => received.some((items) => items.some((i) => i.id === 'garlic')),
        CONVERGENCE_MS,
      );

      const result = await deleteCanonItem('garlic');
      expect(result.kind).toBe('ok');

      await waitFor(
        () => received.some((items) => !items.some((i) => i.id === 'garlic')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      const last = received[received.length - 1]!;
      expect(last.some((i) => i.id === 'garlic')).toBe(false);
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

  describe('subscribeEquipmentManifest', () => {
    it('delivers null when document does not exist', async () => {
      const received: (EquipmentManifest | null)[] = [];
      const unsubscribe = subscribeEquipmentManifest(
        (m) => received.push(m),
        () => {},
      );

      await waitFor(() => received.length > 0, CONVERGENCE_MS);

      unsubscribe();
      expect(received.some((r) => r === null)).toBe(true);
    });

    it('delivers manifest written via saveEquipmentManifest', async () => {
      const received: (EquipmentManifest | null)[] = [];
      const unsubscribe = subscribeEquipmentManifest(
        (m) => received.push(m),
        () => {},
      );

      const item: EquipmentItem = {
        id: 'mixer-1',
        schemaVersion: 1,
        name: 'Stand Mixer',
        accessories: [{ id: 'acc-1', name: 'Dough Hook', owned: true, included: true }],
        rules: ['Use speed 2 for bread'],
        updatedAt: new Date().toISOString(),
      };
      await saveEquipmentManifest({ schemaVersion: 1, updatedAt: '', items: [item] });

      await waitFor(
        () => received.some((m) => m !== null && m.items.some((i) => i.id === 'mixer-1')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((m) => m !== null && m.items.some((i) => i.id === 'mixer-1'))).toBe(
        true,
      );
    });

    it('stops callbacks after unsubscribe', async () => {
      const received: (EquipmentManifest | null)[] = [];
      const unsubscribe = subscribeEquipmentManifest(
        (m) => received.push(m),
        () => {},
      );

      await waitFor(() => received.length > 0, CONVERGENCE_MS);
      const countBeforeUnsub = received.length;
      unsubscribe();

      await saveEquipmentManifest({ schemaVersion: 1, updatedAt: '', items: [] });
      await delay(500);

      expect(received.length).toBe(countBeforeUnsub);
    });
  });

  describe('subscribeShoppingLists', () => {
    it('delivers a list written via createShoppingList', async () => {
      const received: ShoppingList[][] = [];
      const unsubscribe = subscribeShoppingLists(
        (lists) => received.push(lists),
        () => {},
      );

      const list: ShoppingList = {
        id: 'weekly',
        name: 'Weekly Shop',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await createShoppingList(list);

      await waitFor(
        () => received.some((lists) => lists.some((l) => l.id === 'weekly')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((lists) => lists.some((l) => l.id === 'weekly'))).toBe(true);
    });

    it('stops callbacks after unsubscribe', async () => {
      const received: ShoppingList[][] = [];
      const unsubscribe = subscribeShoppingLists(
        (lists) => received.push(lists),
        () => {},
      );

      await waitFor(() => received.length > 0, CONVERGENCE_MS);
      const countBeforeUnsub = received.length;
      unsubscribe();

      await createShoppingList({
        id: 'after-unsub',
        name: 'After',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await delay(500);

      expect(received.length).toBe(countBeforeUnsub);
    });
  });

  describe('subscribeShoppingListItems (subcollection)', () => {
    it('delivers an item written via saveShoppingListItem', async () => {
      const listId = 'emulator-list';
      const received: ShoppingListItem[][] = [];
      const unsubscribe = subscribeShoppingListItems(
        listId,
        (items) => received.push(items),
        () => {},
      );

      const item: ShoppingListItem = {
        id: 'item-1',
        rawText: 'milk 2L',
        notes: '',
        sources: [{ kind: 'manual' }],
        canonId: null,
        matchState: 'pending',
        checked: false,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveShoppingListItem(listId, item);

      await waitFor(
        () => received.some((items) => items.some((i) => i.id === 'item-1')),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((items) => items.some((i) => i.id === 'item-1'))).toBe(true);
    });

    it('delivers an updated item when saved again', async () => {
      const listId = 'emulator-list-update';
      const received: ShoppingListItem[][] = [];
      const unsubscribe = subscribeShoppingListItems(
        listId,
        (items) => received.push(items),
        () => {},
      );

      const item: ShoppingListItem = {
        id: 'item-u',
        rawText: 'eggs',
        notes: '',
        sources: [{ kind: 'manual' }],
        canonId: null,
        matchState: 'pending',
        checked: false,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveShoppingListItem(listId, item);
      await waitFor(
        () => received.some((items) => items.some((i) => i.id === 'item-u')),
        CONVERGENCE_MS,
      );

      const updated: ShoppingListItem = {
        ...item,
        canonId: 'canon-egg',
        matchState: 'matched',
        updatedAt: new Date().toISOString(),
      };
      await saveShoppingListItem(listId, updated);

      await waitFor(
        () =>
          received.some((items) =>
            items.some((i) => i.id === 'item-u' && i.matchState === 'matched'),
          ),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(
        received.some((items) =>
          items.some((i) => i.id === 'item-u' && i.matchState === 'matched'),
        ),
      ).toBe(true);
    });
  });

  describe('subscribeShoppingListsConfig', () => {
    it('delivers null when document does not exist', async () => {
      const received: (ShoppingListsConfig | null)[] = [];
      const unsubscribe = subscribeShoppingListsConfig(
        (cfg) => received.push(cfg),
        () => {},
      );

      await waitFor(() => received.length > 0, CONVERGENCE_MS);

      unsubscribe();
      expect(received.some((r) => r === null)).toBe(true);
    });

    it('delivers config written via saveShoppingListsConfig', async () => {
      const received: (ShoppingListsConfig | null)[] = [];
      const unsubscribe = subscribeShoppingListsConfig(
        (cfg) => received.push(cfg),
        () => {},
      );

      await saveShoppingListsConfig({ defaultListId: 'weekly', schemaVersion: 1 });

      await waitFor(
        () => received.some((cfg) => cfg !== null && cfg.defaultListId === 'weekly'),
        CONVERGENCE_MS,
      );

      unsubscribe();
      expect(received.some((cfg) => cfg !== null && cfg.defaultListId === 'weekly')).toBe(true);
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
