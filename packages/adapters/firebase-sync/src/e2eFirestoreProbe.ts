import { getFirestore, doc, getDocFromCache } from 'firebase/firestore';
import { getApp } from 'firebase/app';

// ─────────────────────────────────────────────────────────────────────────────
// E2E Firestore local-cache probe (issue #734, Phase 1) — emulator-only.
//
// #721 established that the document arrives correctly over the wire and is
// never withdrawn, and still could not say whether a store that went empty lost
// the data itself or was handed an SDK local view that had already lost it.
// This reads the SDK's OWN cache directly, so a failing test can answer that in
// one boolean instead of a session.
//
// `getDocFromCache` is the only reader that never touches the network: it
// resolves from the SDK's local view or rejects, so it cannot perturb the run it
// is diagnosing. The absent-from-cache rejection is a RESULT, not an error —
// caught and reported as `inCache: false`.
//
// Rule 2 puts this here: `getDocFromCache` is browser-`firebase`, which is
// imported only in this package. Like e2eAiStubSync.ts it carries no in-file
// environment conditional — it is reachable only through the e2e bridge, which
// is itself gated on VITE_USE_EMULATORS (apps/web-pwa/src/lib/e2eHooks.ts).
//
// PURE DIAGNOSTICS: never throws, never writes, never touches the network. Same
// contract as apps/web-pwa/e2e/helpers/diagnostics.ts — a diagnostic must never
// change a pass/fail outcome.
// ─────────────────────────────────────────────────────────────────────────────

/** Flat scalars only — this crosses into `ctx_*` telemetry, which drops objects. */
export interface E2EFirestoreCacheProbe {
  /** The document path probed, echoed back so a snapshot is self-describing. */
  readonly path: string;
  /** Did the SDK's local cache hold a view of this document at all? */
  readonly inCache: boolean;
  /** Cached view says the document exists. Null when it was not in cache. */
  readonly exists: boolean | null;
  /** Cached view carries unacknowledged local writes. Null when not in cache. */
  readonly hasPendingWrites: boolean | null;
  /** The document's own `updatedAt`, for the documents that carry one. */
  readonly updatedAt: string | null;
  /** Anything unexpected, reported rather than thrown. */
  readonly error: string | null;
}

/**
 * Reads `path` from the Firestore SDK's local cache and reports what it found.
 *
 * Test-only. `path` is a full slash-separated document path, e.g.
 * `canonData/aisles`.
 */
export async function probeFirestoreCache(path: string): Promise<E2EFirestoreCacheProbe> {
  const absent = (error: string | null): E2EFirestoreCacheProbe => ({
    path,
    inCache: false,
    exists: null,
    hasPendingWrites: null,
    updatedAt: null,
    error,
  });
  try {
    const db = getFirestore(getApp());
    const snap = await getDocFromCache(doc(db, path));
    const data = snap.exists() ? (snap.data() as Record<string, unknown> | undefined) : undefined;
    const updatedAt = data?.['updatedAt'];
    return {
      path,
      inCache: true,
      exists: snap.exists(),
      hasPendingWrites: snap.metadata.hasPendingWrites,
      updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
      error: null,
    };
  } catch (err) {
    // `unavailable` is the SDK's "not in cache" — the answer we came for, not a
    // failure. Anything else is reported in `error` and still resolves.
    const code = (err as { code?: unknown })?.code;
    if (code === 'unavailable') return absent(null);
    return absent((err as Error)?.message ?? String(err));
  }
}
