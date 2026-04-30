import type { DomainError } from '@salt/shared-types';

function firestoreCode(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  // Firestore may prefix codes with 'firestore/' depending on SDK version
  return code.replace(/^firestore\//, '');
}

export function classifyFirestoreError(err: unknown): DomainError {
  // Browser offline check takes priority — no point inspecting the error code
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { kind: 'NetworkError', reason: 'offline' };
  }

  switch (firestoreCode(err)) {
    case 'unavailable':
    case 'failed-precondition':
      return { kind: 'NetworkError', reason: 'offline' };

    case 'deadline-exceeded':
    case 'internal':
    case 'aborted':
      return { kind: 'NetworkError', reason: 'transient' };

    case 'permission-denied':
      return { kind: 'AuthError', reason: 'forbidden' };

    case 'unauthenticated':
      return { kind: 'AuthError', reason: 'unauthenticated' };

    case 'resource-exhausted':
      return { kind: 'StorageError', reason: 'quota-exceeded' };

    case 'data-loss':
      return { kind: 'StorageError', reason: 'corruption' };

    default:
      return { kind: 'StorageError', reason: 'unavailable' };
  }
}
