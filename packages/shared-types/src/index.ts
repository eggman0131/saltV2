// ──────────────────────────────────────────────────────────────────────────
// Result types — the cross-boundary error contract from
// docs/salt-architecture.md §7. Domain commands and adapter functions
// return one of these; they never throw for operational failures.
// ──────────────────────────────────────────────────────────────────────────

export interface Success<T> {
  readonly kind: 'ok';
  readonly value: T;
}

export interface Failure<E> {
  readonly kind: 'err';
  readonly error: E;
}

// Conflict is reserved for adapter-level revision mismatches on
// recipe/canon writes (see §7.4). Domain commands never return Conflict.
export interface Conflict<T> {
  readonly kind: 'conflict';
  readonly local: T;
  readonly remote: T;
}

// ReadResult — for queries and reads (never produces Conflict).
export type ReadResult<T, E> = Success<T> | Failure<E>;

// WriteResult — for sync-time writes that may detect a revision mismatch.
export type WriteResult<T, E> = Success<T> | Failure<E> | Conflict<T>;

// Result — alias for the general (write-shaped) form. Domain commands that
// can never produce a Conflict should declare ReadResult to make the
// no-conflict guarantee part of the type.
export type Result<T, E> = WriteResult<T, E>;

export function success<T>(value: T): Success<T> {
  return { kind: 'ok', value };
}

export function failure<E>(error: E): Failure<E> {
  return { kind: 'err', error };
}

export function conflict<T>(local: T, remote: T): Conflict<T> {
  return { kind: 'conflict', local, remote };
}

// ──────────────────────────────────────────────────────────────────────────
// DomainError — the closed set of error categories from §7.2.
// Adapters normalise Firebase/IndexedDB/network errors into these.
// Domain commands return ValidationError on rule violations.
// ──────────────────────────────────────────────────────────────────────────

export type DomainError =
  | { readonly kind: 'AuthError'; readonly reason: 'unauthenticated' | 'forbidden' | 'expired' }
  | {
      readonly kind: 'NotFound';
      readonly resource: 'recipe' | 'canon' | 'shopping-list' | 'workspace' | 'aisle';
      readonly id: string;
    }
  | {
      readonly kind: 'NetworkError';
      readonly reason: 'offline' | 'unreachable' | 'transient';
    }
  | {
      readonly kind: 'StorageError';
      readonly reason: 'unavailable' | 'quota-exceeded' | 'corruption';
    }
  | {
      readonly kind: 'SyncError';
      readonly reason: 'push-failed' | 'pull-failed' | 'invalid-revision' | 'manifest-mismatch';
    }
  | { readonly kind: 'ConflictError' }
  | { readonly kind: 'ValidationError'; readonly code: ErrorCode; readonly message?: string };

// ──────────────────────────────────────────────────────────────────────────
// DTOs and validation codes
// ──────────────────────────────────────────────────────────────────────────

export type ShoppingBehavior = 'stocked' | 'check' | 'needed';

export type CanonItemUnit = 'g' | 'ml' | 'count';

export interface CanonItemDTO {
  readonly id: string;
  readonly name: string;
  readonly synonyms: readonly string[];
  readonly aisleId: string | null;
  readonly thumbnail: string | null;
  readonly embedding: readonly number[] | null;
  readonly needs_approval: boolean;
  readonly shoppingBehavior: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
  readonly unit?: CanonItemUnit;
  readonly reasoning?: string;
  readonly schemaVersion: 3;
}

export interface AisleDTO {
  readonly id: string;
  readonly name: string;
  readonly order: number;
}

export interface AisleListDTO {
  readonly aisles: readonly AisleDTO[];
  readonly schemaVersion: 1;
}

export const ErrorCode = {
  INVALID_CANON_NAME: 'INVALID_CANON_NAME',
  INVALID_AISLE_NAME: 'INVALID_AISLE_NAME',
  DUPLICATE_AISLE_NAME: 'DUPLICATE_AISLE_NAME',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
