import type { DomainError } from '@salt/shared-types';

// Single source of truth for the caught-error reporting gate
// ("report the unexpected, suppress the expected" — CLAUDE.md §Observability).
//
// Lives in the runtime-neutral src/shared/ area so BOTH the browser default
// subpath and the /server subpath import the same predicate — the report/suppress
// boundary cannot drift between client and CF.
//
// Categorisation drives the gate, not call-site shape:
//   SUPPRESS (expected): NetworkError/offline, ValidationError, NotFound,
//     ConflictError.
//   REPORT (unexpected): everything else — StorageError, SyncError, AuthError,
//     and any future/unknown kind (default-reportable so a new failure mode is
//     surfaced rather than silently swallowed).
//
// NOTE: the sign-out / token-refresh `permission-denied` teardown race is NOT
// handled here. AuthError stays reportable BY CATEGORY; the race is suppressed
// separately via the auth-transition flag in @salt/firebase-sync, which the
// catch/onError call sites consult before reporting an AuthError. A genuine
// rules-misconfig `permission-denied` (no transition in flight) still reports.
const SUPPRESSED_CATEGORIES: ReadonlySet<DomainError['kind']> = new Set<DomainError['kind']>([
  'NetworkError',
  'ValidationError',
  'NotFound',
  'ConflictError',
]);

// `kind` is widened to `| undefined` so the SAME predicate gates both subpaths:
//   • client (Phase 1/2) always passes a concrete DomainError['kind'] — behaviour
//     for every known kind is unchanged.
//   • server (Phase 3) usually catches RAW, uncategorised exceptions (there is no
//     server classifyFirestoreError), so it passes `undefined`. An absent or
//     unrecognised category is "the unexpected" → reportable, matching the policy
//     north star ("report the unexpected, suppress the expected"). This is an
//     evolution of the one source of truth, not a fork: suppression is still keyed
//     ONLY off the explicit SUPPRESSED_CATEGORIES set.
export function isReportableCategory(kind: DomainError['kind'] | undefined): boolean {
  if (kind === undefined) return true; // uncategorised → report the unexpected
  return !SUPPRESSED_CATEGORIES.has(kind);
}
