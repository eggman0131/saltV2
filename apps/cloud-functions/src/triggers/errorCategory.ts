// Maps a firebase-admin Firestore error to a DomainError `kind` string so CF
// logs match the client's DomainError taxonomy (§7.6). Cloud Functions cannot
// depend on @salt/ld-observability (browser-only), so this stays self-contained
// and emits structured strings via `firebase-functions/logger` instead.
export type ErrorCategory =
  | 'AuthError'
  | 'NetworkError'
  | 'StorageError'
  | 'SyncError'
  | 'ValidationError'
  | 'NotFound'
  | 'ConflictError';

export function classifyAdminFirestoreError(err: unknown): ErrorCategory {
  const code = String((err as { code?: unknown } | null)?.code ?? '').replace(/^firestore\//, '');
  switch (code) {
    case 'unavailable':
    case 'failed-precondition':
    case 'deadline-exceeded':
    case 'internal':
    case 'aborted':
      return 'NetworkError';
    case 'permission-denied':
    case 'unauthenticated':
      return 'AuthError';
    case 'resource-exhausted':
    case 'data-loss':
      return 'StorageError';
    case 'not-found':
      return 'NotFound';
    case 'invalid-argument':
    case 'out-of-range':
      return 'ValidationError';
    default:
      return 'StorageError';
  }
}
