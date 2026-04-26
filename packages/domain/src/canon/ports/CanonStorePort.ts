import type { CanonItem } from '../entities/CanonItem.js';

// Infrastructure port: implemented by adapters (local-store / firebase-sync).
// Canon defines what it needs from persistence; adapters provide it.
export interface CanonStorePort {
  save(item: CanonItem): Promise<void>;
  load(id: string): Promise<CanonItem | null>;
  list(): Promise<readonly CanonItem[]>;
  delete(id: string): Promise<void>;
}
