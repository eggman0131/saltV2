import {
  subscribeCookSession,
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

function applySnapshot(sessionId: string, incoming: CookSessionDoc | null): void {
  const local = latestLocalEdit;
  if (incoming === null) {
    // Doc absent or deleted. If we hold a newer local copy for this id (an
    // optimistic create the snapshot hasn't echoed yet), keep it; otherwise
    // reflect the absence.
    if (local && local.id === sessionId) {
      const current = get(_session);
      if (current && current.id === sessionId) return; // keep optimistic copy
    }
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

// ─── Commands ─────────────────────────────────────────────────────────────────

// Stamp updatedAt, update the store optimistically, then persist the whole doc.
export async function persistCookSession(
  session: CookSessionDoc,
): Promise<ReadResult<void, DomainError>> {
  const stamped: CookSessionDoc = { ...session, updatedAt: new Date().toISOString() };
  latestLocalEdit = { id: stamped.id, updatedAt: stamped.updatedAt };
  _session.set(stamped);
  return reportIfFailed(getErrorReporter(), await saveCookSessionDoc(stamped));
}

// Delete the session (Complete / Restart / orphan cleanup). Records the delete as
// a local edit so a stale echo can't resurrect it, clears the store, then deletes.
export async function removeCookSession(id: string): Promise<ReadResult<void, DomainError>> {
  latestLocalEdit = { id, updatedAt: new Date().toISOString() };
  const current = get(_session);
  if (current && current.id === id) _session.set(null);
  return reportIfFailed(getErrorReporter(), await deleteCookSessionDoc(id));
}
