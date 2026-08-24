import { collection, getFirestore, onSnapshot, query } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';
import { parseDocuments, type ParsedBy } from './schemaParsing.js';

// The collection subscription, once (issue #928).
//
// Fourteen modules used to open a live listener on a collection and walk its
// documents, and a structural clone scan found them to be one file copied: same
// `getFirestore(getApp())`, same `onSnapshot`, same parse loop, same
// `classifyFirestoreError` on the stream. What genuinely differed was the
// collection, the schema, and — on four of them — a query constraint. Those are
// the fields of `CollectionRead`, and a new collection is now a call rather than
// a file.
//
// DELIBERATELY NOT EXPORTED FROM index.ts. The package's public surface is the 28
// named `subscribe*` functions, and `tests/subscriptionContract.emulator.test.ts`
// derives its coverage guard from the barrel: a `subscribeCollection` re-exported
// there would read as a 29th subscription with no row.

/**
 * Everything that distinguishes one collection subscription from another.
 *
 * The four query-bounded reads pass their constraints here rather than building
 * their own `query()`, so the whole shape — including the bound — lives in one
 * object beside the collection it bounds.
 */
export interface CollectionRead<TParsed, TDelivered> {
  /**
   * Path segments of the collection to read: one name for a top-level
   * collection, or the full alternating path for a subcollection
   * (`['batches', batchId, 'observations']`).
   *
   * A non-empty tuple, because `collection()` needs at least the name.
   */
  path: readonly [string, ...string[]];
  /**
   * The constraints that bound the read — `where`, `orderBy`, `limit`. Omitted
   * (or empty) means the whole collection, and then no `query()` is built at
   * all: an unbounded read passes the `CollectionReference` straight to
   * `onSnapshot`, exactly as it did before this helper existed.
   */
  constraints?: readonly QueryConstraint[];
  /** The schema every document in the collection is parsed by. */
  schema: ParsedBy<TParsed>;
  /** The name a rejected document is logged under. See `logRejection`. */
  label: string;
  /** One parsed document → what the subscriber receives. See `parseDocuments`. */
  project: (parsed: TParsed, id: string) => TDelivered;
  /**
   * Whether the STREAM path forwards the original Firestore error alongside the
   * categorised `DomainError`, so a reporting call site can send the real stack.
   *
   * True for thirteen of the fourteen; `subscribeMembers` declares a
   * single-argument `onError` and must keep receiving one argument. That is
   * #928's finding B2-009, recorded here as data rather than unified in a
   * consolidation — unifying it is a visible API change and belongs in its own
   * commit. The PARSE path never forwards a raw error, on any subscription:
   * there is no Firestore error to forward, and the absent second argument is
   * what tells a caller the two paths apart.
   */
  forwardsRawError: boolean;
}

/**
 * Subscribe to a collection. Delivers the valid subset on every snapshot;
 * stream-level failures cross as a `Failure`-shaped `DomainError` on `onError`,
 * never as a throw (Rule 10).
 */
export function subscribeCollection<TParsed, TDelivered>(
  read: CollectionRead<TParsed, TDelivered>,
  onDocs: (docs: TDelivered[]) => void,
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  const ref = collection(db, ...read.path);
  const constraints = read.constraints ?? [];
  return onSnapshot(
    constraints.length > 0 ? query(ref, ...constraints) : ref,
    (snap) => onDocs(parseDocuments(snap.docs, read.schema, read.label, read.project)),
    (err) => {
      const domainError = classifyFirestoreError(err);
      if (read.forwardsRawError) onError(domainError, err);
      else onError(domainError);
    },
  );
}
