import { doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';
import { logRejection, type ParsedBy } from './schemaParsing.js';

// The single-document subscription, once (issue #928).
//
// Fourteen modules used to open a live listener on ONE document — a singleton, a
// document keyed by a recipe, a week, a uid — and the clone scan scored
// `devSettingsSync` against `appSettingsSync` at 1.00, with `weatherSync` a third
// copy at 0.95. What differs between them is the collection, the key, the schema,
// and what each does with a document that fails to parse. Those are the fields of
// `DocumentRead`.
//
// DELIBERATELY NOT EXPORTED FROM index.ts — see the note in subscribeCollection.ts.

/** Everything that distinguishes one single-document subscription from another. */
export interface DocumentRead<T> {
  /**
   * The full path of the document: collection, key, and any further segments.
   * A non-empty tuple, because `doc()` needs at least a collection name.
   */
  path: readonly [string, ...string[]];
  /** The schema the document is parsed by. */
  schema: ParsedBy<T>;
  /** The name a rejected document is logged under. See `logRejection`. */
  label: string;
  /**
   * What this read does with a document that fails its schema.
   *
   * `'error'` — a `StorageError`/`corruption` on `onError`, which is what
   * CLAUDE.md's zod conventions ask of a single-document adapter read. The
   * caller keeps whatever it was holding, so a document somebody wrote is never
   * presented as one that was never written.
   * `'null'`  — deliver `null`, indistinguishable to the caller from a document
   * that does not exist. Only `subscribeCookSession` and
   * `subscribeKitchenTimers`, both of which read genuinely disposable state that
   * the next write replaces outright.
   *
   * The divergence is real and is left alone here: normalising it would change
   * what two pages do with a corrupt document, which is a behaviour change and
   * belongs in a commit that says so rather than inside a consolidation.
   */
  onCorrupt: 'error' | 'null';
}

/**
 * Subscribe to one document. Delivers the parsed document, or `null` when it does
 * not exist. Stream-level failures cross as a `DomainError` on `onError`, never
 * as a throw (Rule 10).
 *
 * `onError` has ONE signature across every single-document read (#928 finding
 * B2-009): the stream path always forwards the original Firestore error as a
 * second argument, so a reporting call site gets the real stack; the parse path
 * always passes one argument, because a corruption `Failure` is synthetic and
 * has no Firestore error behind it. That difference is the caller's only way to
 * tell the two paths apart, and it is now a property of the path rather than of
 * which subscription you happen to be holding.
 */
export function subscribeDocument<T>(
  read: DocumentRead<T>,
  onDoc: (document: T | null) => void,
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, ...read.path),
    (snap) => {
      if (!snap.exists()) {
        onDoc(null);
        return;
      }
      const result = read.schema.safeParse(snap.data());
      if (result.success) {
        onDoc(result.data);
        return;
      }
      logRejection(read.label, snap.id, result.error);
      // One argument, always: the corruption Failure is synthetic and has no
      // Firestore error behind it, and its absent second argument is what tells
      // a caller this came from the parse and not from the stream.
      if (read.onCorrupt === 'error') onError({ kind: 'StorageError', reason: 'corruption' });
      else onDoc(null);
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}
