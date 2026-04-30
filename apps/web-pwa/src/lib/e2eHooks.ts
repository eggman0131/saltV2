import { get } from 'svelte/store';
import { createLocalCanonStoreAdapter } from '@salt/local-store';
import type { CanonItem } from '@salt/domain';
import { devSignIn } from './auth.svelte.js';
import { addAislesBulk, aisles } from './aisleService.js';
import { tagSession, getSessionURL } from './observability.js';
import type { E2EBridge, SeedCanonItemInput } from './types/e2e.js';

const INDEXED_DB_NAMES = ['salt-aisles-v1', 'salt-v1'];

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export function installE2EHooks(): void {
  if (import.meta.env.VITE_USE_EMULATORS !== 'true') return;

  const canonStore = createLocalCanonStoreAdapter();

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
        name: input.name,
        synonyms: input.synonyms ?? [],
        aisleId: input.aisleId ?? null,
        thumbnail: input.thumbnail ?? null,
        embedding: input.embedding ?? null,
        needs_approval: input.needs_approval ?? false,
      };
      const result = await canonStore.upsert(item);
      if (result.kind !== 'ok') {
        throw new Error(`seedCanonItem failed: ${JSON.stringify(result.error)}`);
      }
      return item;
    },

    getAisles() {
      return get(aisles);
    },

    async getCanonItem(id) {
      const result = await canonStore.load(id);
      if (result.kind !== 'ok') {
        throw new Error(`getCanonItem failed: ${JSON.stringify(result.error)}`);
      }
      return result.value;
    },

    async clearStores() {
      await Promise.all(INDEXED_DB_NAMES.map(deleteDatabase));
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
