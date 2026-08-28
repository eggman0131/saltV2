import {
  subscribeCookSession,
  subscribeMyCookSessions,
  saveCookSession as saveCookSessionDoc,
  deleteCookSession as deleteCookSessionDoc,
} from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import type { CookSessionDoc } from '@salt/domain/schemas';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';
import { type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Cook session service (cooking mode, Phase 1). An optimistic store over the
// firebase-sync single-doc subscription. Unlike recipeService (which holds the
// whole collection), a cook session is ONE document — one user, one recipe — so
// the store is a single `CookSessionDoc | null`. Writes update the store
// immediately and persist the whole document (whole-document LWW on `updatedAt`).
// The cook page owns the subscription lifecycle: it calls initCookSessionSync with
// the deterministic id and disposes the returned unsub on teardown.

// ─── Reactive store ─────────────────────────────────────────────────────────────

const _session = writable<CookSessionDoc | null>(null);
export const cookSession: Readable<CookSessionDoc | null> = _session;

// Synchronous snapshot of the current session. Used by the tick/persist handlers
// so they read the freshest state without threading the store value through.
export function getCookSessionSnapshot(): CookSessionDoc | null {
  return get(_session);
}

const _isLoadingCookSession = writable(true);
export const isLoadingCookSession: Readable<boolean> = _isLoadingCookSession;

// True once a session we were holding has been cleared by a snapshot saying the
// document is gone — i.e. it was completed or restarted on ANOTHER device. The
// distinction matters because the page bootstraps a fresh session whenever the
// store reads null: without this signal it would answer a remote delete by
// writing the session straight back, resurrecting a cook the user just finished.
// A LOCAL Complete / Restart (removeCookSession) does not set it — those paths
// clear the store themselves and already know where they are going next.
// Reset by initCookSessionSync.
const _cookSessionEnded = writable(false);
export const cookSessionEnded: Readable<boolean> = _cookSessionEnded;

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Snapshot guard ─────────────────────────────────────────────────────────────
// Newest `updatedAt` we've applied locally for the current session id (from an
// optimistic write or an accepted snapshot). Guards against an in-flight stale
// snapshot echo landing after a newer local edit and reverting it — the same
// pattern as the collection stores, narrowed to the single active session. A
// local delete records `now` so a stale echo can't resurrect the deleted doc.
let latestLocalEdit: { id: string; updatedAt: string } | null = null;

// Count of our own writes that Firestore has not yet acknowledged. An absence
// cannot be trusted while one is outstanding: it may have been queued before the
// write reached the local cache, and applying it would blank a session that
// exists. The write supersedes the absence either way — on success Firestore
// re-emits the document, and on failure the optimistic copy is deliberately kept
// (a failed write must not disrupt the cook) — so a swallowed absence is dropped
// rather than replayed. Deletes are NOT counted: during a delete an absence is
// exactly the truth we want. Never reset on re-subscribe — the decrement runs in
// a `finally` that would drive a reset counter negative, and the store reset in
// initCookSessionSync already makes the guard inert.
let pendingWrites = 0;

function applySnapshot(sessionId: string, incoming: CookSessionDoc | null): void {
  const local = latestLocalEdit;
  if (incoming === null) {
    if (pendingWrites > 0) return; // keep the optimistic copy; see above
    // The document really is gone. If we were cooking this session, it ended on
    // another device — flag that so the page reports the end rather than treating
    // the absence as "no session yet" and creating one over the top of the delete.
    const current = get(_session);
    if (current && current.id === sessionId) _cookSessionEnded.set(true);
    _session.set(null);
    return;
  }
  if (local && local.id === incoming.id && incoming.updatedAt < local.updatedAt) {
    // Stale echo: our local copy (or local delete) is newer — ignore it.
    return;
  }
  latestLocalEdit = { id: incoming.id, updatedAt: incoming.updatedAt };
  _session.set(incoming);
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

// Subscribe to a single cook session by its deterministic id. Resets the store to
// a clean loading state first so switching recipes never shows a stale session.
export function initCookSessionSync(sessionId: string): () => void {
  _isLoadingCookSession.set(true);
  _session.set(null);
  _cookSessionEnded.set(false);
  latestLocalEdit = null;
  const errors = getErrorReporter();
  const unsub = subscribeCookSession(
    sessionId,
    (incoming) => {
      applySnapshot(sessionId, incoming);
      _isLoadingCookSession.set(false);
    },
    (err, rawError) => {
      reportSubscriptionError(errors, err, rawError);
      _isLoadingCookSession.set(false);
    },
  );
  return unsub;
}

// ─── My open sessions (issue #634) ──────────────────────────────────────────────

// Every cook I have on the go, newest first. Distinct from `cookSession` above:
// that one is the session the cook page is driving (looked up by deterministic
// id), this is "am I mid-cook right now" asked without naming a recipe — the
// question the personal view opens with. Subscribed app-wide from App.svelte, so
// the answer is available on every page for the nav badge.
const _myCookSessions = writable<readonly CookSessionDoc[]>([]);
export const myCookSessions: Readable<readonly CookSessionDoc[]> = _myCookSessions;

export function initMyCookSessionsSync(uid: string): () => void {
  const errors = getErrorReporter();
  const unsub = subscribeMyCookSessions(
    uid,
    (sessions) => _myCookSessions.set(sessions),
    (err, rawError) => {
      // A stream-level failure leaves the list empty: the resume card and its
      // badge simply don't appear. Reported from here — the adapter cannot
      // report (Rule 4 forbids firebase-sync importing observability), so the
      // call below is the only path to the category gate.
      reportSubscriptionError(errors, err, rawError);
    },
  );
  return () => {
    unsub();
    _myCookSessions.set([]);
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// Stamp updatedAt, update the store optimistically, then persist the whole doc.
export async function persistCookSession(
  session: CookSessionDoc,
): Promise<ReadResult<void, DomainError>> {
  const stamped: CookSessionDoc = { ...session, updatedAt: new Date().toISOString() };
  latestLocalEdit = { id: stamped.id, updatedAt: stamped.updatedAt };
  _session.set(stamped);
  pendingWrites += 1;
  try {
    return reportIfFailed(getErrorReporter(), await saveCookSessionDoc(stamped));
  } finally {
    pendingWrites -= 1;
  }
}

// Delete the session (Complete / Restart / orphan cleanup, and — since #682 —
// Cancel from the personal view). Records the delete as a local edit so a stale
// echo can't resurrect it, clears the store, then deletes. The store clear is a
// no-op for the /mine call: that page renders from `myCookSessions`, which picks
// the delete up from the local cache like any other snapshot.
export async function removeCookSession(id: string): Promise<ReadResult<void, DomainError>> {
  latestLocalEdit = { id, updatedAt: new Date().toISOString() };
  const current = get(_session);
  if (current && current.id === id) _session.set(null);
  return reportIfFailed(getErrorReporter(), await deleteCookSessionDoc(id));
}
