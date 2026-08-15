import {
  subscribeKitchenMemories,
  saveKitchenMemory,
  deleteKitchenMemory,
} from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';
import { currentMember } from './membersService.js';
import type { KitchenMemoryDoc } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Kitchen-memory service (issue #816, phase 1) — the store over `kitchenMemories`
// and the ONE WRITE PATH for it.
//
// It is also where the two things the adapter cannot supply are minted: the note's
// id (`crypto.randomUUID()`, as batchService mints a run's) and the clock. Nothing
// below this line reads a clock and nothing above it invents an id.
//
// NO AI ANYWHERE. Writing a note is a `setDoc`; there is no flow, no callable and
// no per-turn cost, which is what lets `/remember` land instantly and offline.
//
// The subscription is NOT started at app boot. The page that shows the notes owns
// its lifecycle (`$effect(() => initKitchenMemorySync())`), which is the house
// pattern — see BatchListPage. Phase 1's chef is unaware of these notes, so nothing
// else needs them loaded, and paying for a collection listener on every session to
// serve one screen would be the wrong default.

// ─── Reactive stores ─────────────────────────────────────────────────────────

const _memories = writable<readonly KitchenMemoryDoc[]>([]);
export const memories: Readable<readonly KitchenMemoryDoc[]> = _memories;

const _isLoadingMemories = writable(true);
export const isLoadingMemories: Readable<boolean> = _isLoadingMemories;

// ─── Error reporting ─────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Init / cleanup ──────────────────────────────────────────────────────────

/** Subscribe to every note, for as long as the caller keeps the unsub. */
export function initKitchenMemorySync(): () => void {
  _isLoadingMemories.set(true);
  const errors = getErrorReporter();
  return subscribeKitchenMemories(
    (incoming) => {
      _memories.set(incoming);
      _isLoadingMemories.set(false);
    },
    (err, rawError) => {
      // A stream-level error leaves the list empty; stop the spinner so the page
      // settles on its empty state rather than hanging on a loader.
      reportSubscriptionError(errors, err, rawError);
      _isLoadingMemories.set(false);
    },
  );
}

// ─── Commands ────────────────────────────────────────────────────────────────

// Who wrote it, in the words a screen can show: the signed-in member's display
// name, denormalised onto the note at write time.
//
// `currentMember` is null when nobody is signed in, when the roster has not loaded
// yet, or when the signed-in email is not on it — and Firebase Auth's `User` in this
// app carries only uid and email, so there is no `displayName` to fall back to.
// Hence an explicit, human fallback. NEVER a uid: uids appear nowhere in the
// family-shared data model, and one would be unreadable in the single place this
// field exists to be read.
function authorName(): string {
  return get(currentMember)?.name ?? 'Someone';
}

/**
 * Save a note. Returns the write's result so a caller that must not proceed on
 * failure (the `/remember` branch in chatService) can stop.
 */
export async function rememberNote(text: string): Promise<ReadResult<void, DomainError>> {
  const memory: KitchenMemoryDoc = {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    text: text.trim(),
    author: authorName(),
    createdAt: new Date().toISOString(),
  };
  return reportIfFailed(getErrorReporter(), await saveKitchenMemory(memory));
}

/** Forget a note. A real delete — Salt has no soft-delete and no tombstones. */
export async function forgetNote(id: string): Promise<ReadResult<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await deleteKitchenMemory(id));
}
