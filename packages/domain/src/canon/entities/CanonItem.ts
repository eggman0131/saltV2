// Canon entity: a canonical ingredient definition.
// Lives in canon/entities — internal to the canon module.
// Other modules access it only via the published index (re-exported as a type).
import type { ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { PendingCanonChangeDoc } from '../../schemas/canonItem.js';
export type { ShoppingBehavior, CanonItemUnit };

/** One thing the matching pipeline changed, pending review. See
 *  PendingCanonChangeSchema for the persistence contract. */
export type PendingCanonChange = PendingCanonChangeDoc;

export interface CanonItem {
  readonly id: string;
  readonly schemaVersion: 5;
  readonly name: string;
  readonly synonyms: readonly string[];
  readonly aisleId: string | null;
  readonly thumbnail: string | null;
  // Transient one-shot steer for the next icon (re)generation (issue #148);
  // written on regenerate, consumed + cleared by the CF icon branch.
  readonly iconHint?: string;
  // Regenerate nonce (epoch ms): stamped on every regenerate request so the
  // write always mutates the doc (even when thumbnail is already null) and the
  // onCanonItemWritten icon branch re-fires. See CanonItemSchema.
  readonly iconRequestedAt?: number;
  readonly embedding: readonly number[] | null;
  readonly needs_approval: boolean;
  readonly shoppingBehavior: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
  readonly unit?: CanonItemUnit;
  readonly reasoning?: string;
  // What the pipeline changed, pending review (issue #193). Optional: absent
  // means "not recorded" (a doc written before this shipped, or an item nobody
  // flagged), never "nothing changed". Cleared — key omitted — on approve.
  readonly pendingChanges?: readonly PendingCanonChange[];
  // Sync fields — stamped server-side by the onCanonItemWritten CF trigger.
  readonly updatedAt: string; // ISO-8601
}
