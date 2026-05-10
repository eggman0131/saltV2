// Canon entity: a canonical ingredient definition.
// Lives in canon/entities — internal to the canon module.
// Other modules access it only via the published index (re-exported as a type).
import type { ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
export type { ShoppingBehavior, CanonItemUnit };

export interface CanonItem {
  readonly id: string;
  readonly schemaVersion: 4;
  readonly name: string;
  readonly synonyms: readonly string[];
  readonly aisleId: string | null;
  readonly thumbnail: string | null;
  readonly embedding: readonly number[] | null;
  readonly needs_approval: boolean;
  readonly shoppingBehavior: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
  readonly unit?: CanonItemUnit;
  readonly reasoning?: string;
  // Sync fields — stamped server-side by the onCanonItemWritten CF trigger.
  readonly updatedAt: string; // ISO-8601
  readonly deletedAt: string | null; // null = live; non-null = soft-deleted tombstone
}
