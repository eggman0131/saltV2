// Canon entity: a canonical ingredient definition.
// Lives in canon/entities — internal to the canon module.
// Other modules access it only via the published index (re-exported as a type).
import type { ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { CanonItemDoc, PendingCanonChangeDoc } from '../../schemas/canonItem.js';
export type { ShoppingBehavior, CanonItemUnit };

/** One thing the matching pipeline changed, pending review. See
 *  PendingCanonChangeSchema for the persistence contract. */
export type PendingCanonChange = PendingCanonChangeDoc;

// One Firestore document at `canonItems/{id}`. Schema-first (issue #417,
// carried to the remaining domain modules by issue #932): `CanonItemSchema` is
// the single source of truth, so the entity and the stored document can no
// longer drift behind a cast at the read boundary.
//
// Two narrowings, both deliberate — an alias that took the schema type whole
// would be wrong in each case:
//
//   `traceContext` is OMITTED. It is transport only: the firestoreCanonStore
//   adapter adds it at write time so the pure-domain CanonItem never carries it
//   (domain purity — CLAUDE.md Rule 1, and the field's own comment on
//   CanonItemSchema). Carrying it here would also change what upsertCanonItem
//   is allowed to write back.
//
//   `embedding` is narrowed back to REQUIRED and non-`undefined`. The schema has
//   it `.optional()` purely as an issue #410 back-compat read fallback for
//   un-migrated docs, but every reader sees a post-projection item, where it is
//   always present-or-null (canonSubscription projects it to null;
//   firestoreCanonStore merges the relocated vector or null). embedMatch relies
//   on exactly that: it filters `embedding !== null` and then dereferences with
//   `!`, so a widened `| undefined` would pass undefined into cosineSimilarity.
export type CanonItem = Omit<CanonItemDoc, 'traceContext' | 'embedding'> & {
  readonly embedding: readonly number[] | null;
};
