import { get } from 'svelte/store';
import { upsertCanonItem, setFirestoreNetwork } from '@salt/firebase-sync';
import type { CanonItem } from '@salt/domain';
import { devSignIn } from './auth.svelte.js';
import { addAislesBulk, aisles } from './aisleService.js';
import { canonItems } from './canonService.js';
import { tagSession, getSessionURL } from './observability.js';
import type { E2EBridge, SeedCanonItemInput } from './types/e2e.js';

export function installE2EHooks(): void {
  if (import.meta.env.VITE_USE_EMULATORS !== 'true') return;

  const bridge: E2EBridge = {
    devSignIn,

    async seedAisles(names) {
      const result = await addAislesBulk([...names]);
      if (result.kind !== 'ok') {
        throw new Error(`seedAisles failed: ${JSON.stringify(result.error)}`);
      }
      return result.value;
    },

    async seedCanonItem(input: SeedCanonItemInput) {
      const item: CanonItem = {
        id: input.id ?? crypto.randomUUID(),
        schemaVersion: 3,
        name: input.name,
        synonyms: input.synonyms ?? [],
        aisleId: input.aisleId ?? null,
        thumbnail: input.thumbnail ?? null,
        embedding: input.embedding ?? null,
        needs_approval: input.needs_approval ?? false,
        shoppingBehavior: 'needed',
        updatedAt: '',
        revision: 0,
        deletedAt: null,
      };
      // Fire-and-forget: setDoc hangs when the SDK network is disabled (offline
      // test). Firestore still writes to local cache and fires onSnapshot
      // immediately, so we wait for the store to reflect the write instead.
      void upsertCanonItem(item);
      const deadline = Date.now() + 5000;
      while (!get(canonItems).some((i) => i.id === item.id)) {
        if (Date.now() > deadline)
          throw new Error(`seedCanonItem: item ${item.id} not in store after 5s`);
        await new Promise((r) => setTimeout(r, 50));
      }
      return item;
    },

    getAisles() {
      return get(aisles);
    },

    async getCanonItem(id) {
      return get(canonItems).find((i) => i.id === id) ?? null;
    },

    async clearStores() {
      // Firestore persistent cache is managed by the SDK; no local stores to clear.
    },

    async setFirestoreOffline(offline: boolean) {
      await setFirestoreNetwork(!offline);
    },

    tagSession(meta) {
      tagSession(meta);
    },

    getLDSessionURL() {
      return getSessionURL();
    },
  };

  window.__e2e = bridge;

  if (window.__e2eAutoTag) {
    bridge.tagSession(window.__e2eAutoTag);
  }
}
