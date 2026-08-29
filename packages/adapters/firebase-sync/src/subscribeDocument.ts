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
// copy at 0.95. All that differs between them is the collection, the key and the
// schema, which is exactly what `DocumentRead` now carries: three fields and no
// boolean, so a fifteenth read has nothing to diverge on. What each does with a
// refused document was the fourth field until #928 Phase 2, and is now the one
// answer below.
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
}

/**
 * Subscribe to one document. Delivers the parsed document, or `null` when it does
 * not exist. Stream-level failures cross as a `DomainError` on `onError`, never
 * as a throw (Rule 10).
 *
 * A document the schema REFUSES is `{kind:'StorageError', reason:'corruption'}`
 * on `onError` — never a `null` (#928 Phase 2). `null` means "no such document",
 * and two reads used to answer a refusal with it: `subscribeCookSession` and
 * `subscribeKitchenTimers`, on the grounds that both hold disposable state the
 * next write replaces. That was wrong at the call site rather than merely
 * inconsistent. `cookSessionService.applySnapshot` reads a `null` as the
 * document being GONE, so a corrupt `cookSessions/{id}` either fired the "this
 * cook was finished on another device" toast and evicted the user from cook
 * mode, or — with an empty store — read as "no session yet" and let the page
 * write a fresh session over the corrupt one. The caller now keeps what it
 * holds and the corruption is reported, per `docs/data-model.md`'s
 * single-document read row.
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
      onError({ kind: 'StorageError', reason: 'corruption' });
    },
    (err) => onError(classifyFirestoreError(err), err),
  );
}
