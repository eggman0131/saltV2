import { subscribeKitchenTimers, saveKitchenTimers } from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import type { KitchenTimersDoc } from '@salt/domain/schemas';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';
import { type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Standalone kitchen timers (issue #842). An optimistic store over the
// firebase-sync single-doc subscription for `kitchenTimers/{uid}` — every timer
// of mine that belongs to nobody's cook.
//
// Subscribed APP-WIDE from App.svelte at auth time, alongside my open cook
// sessions, for two reasons that both matter: the nav badge counts fired timers
// from every page, and the app-level chime watcher (cookTimerAlerts) has to be
// able to ring a timer that finishes while I am on the shopping list.
//
// The uid is held here rather than read from the auth store at each call site,
// because it is BOTH the document id and a pinned field — the security rule
// requires the two to agree — and a service that has already been told who it
// is syncing can synthesise the empty document for a member who has never
// started a timer, which is what makes the very first start an ordinary write.

// ─── Reactive store ─────────────────────────────────────────────────────────────

const _kitchenTimers = writable<KitchenTimersDoc | null>(null);
export const kitchenTimers: Readable<KitchenTimersDoc | null> = _kitchenTimers;

// Whose kitchen is currently synced. Null when signed out, which is the one
// state in which there is no honest answer to "what should I write?".
let syncedUid: string | null = null;

/**
 * The document to base the next write on.
 *
 * Returns the live document, or — when the member has never started a timer, so
 * no document exists yet — a fresh empty one for them. That absence is the
 * ordinary state on a new account rather than an error, so answering it with
 * null would make every caller re-implement the same bootstrap.
 *
 * Null only when nobody is signed in, where there is genuinely no kitchen to
 * write to.
 */
export function getKitchenTimersSnapshot(): KitchenTimersDoc | null {
  const current = get(_kitchenTimers);
  if (current) return current;
  if (!syncedUid) return null;
  return { ownerUid: syncedUid, timers: [] };
}

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

export function initKitchenTimerSync(uid: string): () => void {
  syncedUid = uid;
  _kitchenTimers.set(null);
  const errors = getErrorReporter();
  const unsub = subscribeKitchenTimers(
    uid,
    (incoming) => _kitchenTimers.set(incoming),
    (err, rawError) => {
      // A stream-level failure leaves the store empty: standalone timers simply
      // do not appear, and cook timers on the same page are unaffected. The
      // adapter's DomainError is reported per the observability gate.
      reportSubscriptionError(errors, err, rawError);
    },
  );
  return () => {
    unsub();
    syncedUid = null;
    _kitchenTimers.set(null);
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Persist the whole timers document, updating the store first.
 *
 * No `updatedAt` guard, unlike cookSessionService — this schema deliberately
 * carries no timestamp, because nothing reads one and LWW here is whole-document
 * and unconditional. The optimistic set is what makes the countdown appear on
 * the same frame as the tap rather than on the snapshot round-trip.
 */
export async function persistKitchenTimers(
  timers: KitchenTimersDoc,
): Promise<ReadResult<void, DomainError>> {
  _kitchenTimers.set(timers);
  return reportIfFailed(getErrorReporter(), await saveKitchenTimers(timers));
}
