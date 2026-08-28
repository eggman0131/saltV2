import { collection, getFirestore, onSnapshot, query } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';
import { parseDocument, type ParsedBy, type ParseOutcome } from './schemaParsing.js';

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
}

/**
 * Subscribe to a collection. Delivers the valid subset on every snapshot;
 * stream-level failures cross as a `Failure`-shaped `DomainError` on `onError`,
 * never as a throw (Rule 10). The original Firestore error rides alongside as
 * the second argument, on every collection read alike (#928 finding B2-009), so
 * a reporting call site can send the real stack. The PARSE path forwards
 * nothing: a refused document is skipped and logged, and never reaches
 * `onError` at all.
 *
 * ─── Only what changed is parsed (issue #939) ────────────────────────────────
 * A snapshot used to be walked whole: `snap.docs` re-`safeParse`d end to end
 * every time any one document in the collection moved. At the measured cost of
 * ~21 µs per recipe that is 1.3 ms per snapshot at today's 64 recipes and
 * 10.6 ms at the several hundred the library is heading for — and a recipe
 * import is four snapshots, not one, because `onRecipeWritten` writes the
 * thumbnail, the kit and the canonicalised ingredients back afterwards.
 *
 * `snap.docChanges()` is the view over the same already-materialised snapshot
 * that says which documents actually differ, so the loop below parses `k`
 * documents rather than `N` — `k = N` once, on the first snapshot, and `k = 1`
 * per ordinary write thereafter. Nothing about the query, the transport or the
 * billing changes; this is entirely a main-thread saving.
 *
 * ORDER STILL COMES FROM `snap.docs`, and that is the whole reason this is a
 * cache beside the walk rather than a local array spliced by `oldIndex`/
 * `newIndex`. The splice is the shape the Firestore docs show, and it is a
 * standing invitation to reorder a result set by one index and never notice:
 * two subscriptions impose a real order — `subscribeBatchObservations`
 * (`orderBy('at','asc')`) and `subscribeMyCookSessions`
 * (`orderBy('updatedAt','desc')` + `limit(5)`, where a sixth session pushes the
 * oldest out) — and both would fail silently and permanently. Walking `snap.docs`
 * makes the delivered order *identical to a full re-read by construction*, costs
 * two Map operations per document (single-digit µs at N = 500, against the
 * 10.6 ms of parsing it removes), and handles a document leaving a `limit`
 * window with no removal branch at all.
 *
 * WHAT THE CACHE RESTS ON is that `snap.docs` can never carry content `snap
 * .docChanges()` did not mention — not on `docChanges()` being merely a hint. It
 * is worth being exact, because the failure it would cause is invisible: a
 * MISSED MODIFICATION would serve the stale cached parse indefinitely, not
 * re-parse it. (A missed ADD is harmless — no cache entry, so it is parsed; so
 * is a missed REMOVAL — absent from `snap.docs`, so it is dropped.) The
 * invariant holds in the pinned SDK, `@firebase/firestore@4.17.0`: in
 * `View.computeDocChanges` (`src/core/view.ts`) `newDocumentSet` is only updated
 * inside `if (changeApplied)`, and every branch that sets `changeApplied` also
 * records a change — so the two are written together or not at all. Metadata-only
 * changes cannot produce a counterexample either: `QueryListener.onViewSnapshot`
 * strips `ChangeType.Metadata` before raising, and a snapshot with nothing left
 * raises no event. And a fresh listener always starts from
 * `ViewSnapshot.fromInitialDocuments`, which reports every document as `added`,
 * so the first snapshot on a new subscription parses the lot.
 *
 * OBJECT IDENTITY IS NOW STABLE across snapshots. An unchanged document is
 * delivered as the same object it was delivered as last time, where before every
 * snapshot allocated afresh — that is the point, and it is what stops canon's
 * `{...item, embedding: null}` projection (#410) running 281 times per snapshot.
 * Safe because no consumer mutates a delivered document in place: every service
 * copies (`recipeService`/`chatService` build a new array in `applySnapshot`, the
 * rest `set` the store). The delivered ARRAY is still built fresh per snapshot,
 * so a caller that sorts what it is handed still sorts only its own copy.
 *
 * A document the schema REFUSED is cached as a refusal rather than forgotten, so
 * a corrupt document costs one parse and one `logRejection` instead of one of
 * each per snapshot for as long as it sits there.
 */
export function subscribeCollection<TParsed, TDelivered>(
  read: CollectionRead<TParsed, TDelivered>,
  onDocs: (docs: TDelivered[]) => void,
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  const ref = collection(db, ...read.path);
  const constraints = read.constraints ?? [];

  // What every document in the last snapshot came to, by id. Private to this
  // listener, so it dies with the unsubscribe and a fresh subscription parses
  // the whole collection again, exactly as a first snapshot should.
  let parsed = new Map<string, ParseOutcome<TDelivered>>();

  return onSnapshot(
    constraints.length > 0 ? query(ref, ...constraints) : ref,
    (snap) => {
      // Added and modified alike: the document's contents are new to us, so the
      // cached answer for that id is stale. A removal needs no entry here — the
      // document is simply absent from `snap.docs` below.
      const stale = new Set<string>();
      for (const change of snap.docChanges()) {
        if (change.type !== 'removed') stale.add(change.doc.id);
      }

      const next = new Map<string, ParseOutcome<TDelivered>>();
      const docs: TDelivered[] = [];
      for (const d of snap.docs) {
        const outcome =
          (stale.has(d.id) ? undefined : parsed.get(d.id)) ??
          parseDocument(d, read.schema, read.label, read.project);
        next.set(d.id, outcome);
        if (outcome.ok) docs.push(outcome.value);
      }
      parsed = next;
      // Every snapshot delivers, the empty first one included — unchanged from
      // the whole-snapshot loop this replaced.
      onDocs(docs);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}
