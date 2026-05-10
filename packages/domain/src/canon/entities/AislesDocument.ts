import type { Aisle } from './Aisle.js';

// Wire shape of the canonData/aisles Firestore document.
// The aisles array is stored as a single document; updatedAt is stamped client-side by saveAisles (see firebase-sync/aisleSubscription.ts).
export interface AislesDocument {
  readonly schemaVersion: 1;
  readonly updatedAt: string; // ISO-8601
  readonly aisles: readonly Aisle[];
}
