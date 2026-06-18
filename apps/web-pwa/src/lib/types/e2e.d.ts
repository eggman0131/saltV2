import type {
  Aisle,
  CanonItem,
  EquipmentManifest,
  ShoppingList,
  ShoppingListItem,
} from '@salt/domain';
import type { ObservabilitySessionMeta } from '@salt/ld-observability';

export interface SeedCanonItemInput {
  readonly id?: string;
  readonly name: string;
  readonly aisleId?: string | null;
  readonly synonyms?: readonly string[];
  readonly thumbnail?: string | null;
  readonly embedding?: readonly number[] | null;
  readonly needs_approval?: boolean;
}

export interface E2EBridge {
  devSignIn(email: string): Promise<void>;
  seedAisles(names: readonly string[]): Promise<readonly Aisle[]>;
  seedCanonItem(input: SeedCanonItemInput): Promise<CanonItem>;
  getAisles(): readonly Aisle[];
  getCanonItem(id: string): Promise<CanonItem | null>;
  // True once the canon sync (items + aisles onSnapshot listeners) has
  // delivered its first snapshot — i.e. the listeners are attached and settled.
  // Cross-tab convergence tests wait on this before the writer tab seeds, so
  // the reader's listener attaches in a calm window rather than mid-navigation.
  isCanonSynced(): boolean;
  clearStores(): Promise<void>;
  setFirestoreOffline(offline: boolean): Promise<void>;
  seedEquipmentManifest(manifest: EquipmentManifest): Promise<void>;
  getEquipmentManifest(): EquipmentManifest | null;
  getShoppingLists(): readonly ShoppingList[];
  getDefaultListId(): string | null | undefined;
  getShoppingListItems(): readonly ShoppingListItem[];
  tagSession(meta: ObservabilitySessionMeta): void;
  getLDSessionURL(): string | null;
}

declare global {
  interface Window {
    __e2e?: E2EBridge;
    __e2eAutoTag?: ObservabilitySessionMeta;
  }
}

export {};
