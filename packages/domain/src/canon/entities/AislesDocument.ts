import type { Aisle } from './Aisle.js';

// Wire shape of the canonData/aisles Firestore document.
// The aisles array is stored as a single document; revision and updatedAt are
// stamped server-side by the onAislesWritten CF trigger.
export interface AislesDocument {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly updatedAt: string; // ISO-8601
  readonly aisles: readonly Aisle[];
}
