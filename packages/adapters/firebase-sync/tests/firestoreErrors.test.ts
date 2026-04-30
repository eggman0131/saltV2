import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyFirestoreError } from '../src/firestoreErrors.js';

function fbError(code: string): Error & { code: string } {
  const err = new Error(`Firebase: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  // Node.js ≥ v21 exposes navigator globally with onLine = false by default.
  // Stub to true so tests that don't involve offline behaviour get correct results.
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifyFirestoreError — offline detection', () => {
  it('returns NetworkError:offline when navigator.onLine is false', () => {
    vi.stubGlobal('navigator', { onLine: false }); // override the beforeEach stub
    expect(classifyFirestoreError(new Error('any'))).toEqual({
      kind: 'NetworkError',
      reason: 'offline',
    });
  });

  it('returns NetworkError:offline for unavailable code', () => {
    expect(classifyFirestoreError(fbError('unavailable'))).toEqual({
      kind: 'NetworkError',
      reason: 'offline',
    });
  });

  it('returns NetworkError:offline for failed-precondition code', () => {
    expect(classifyFirestoreError(fbError('failed-precondition'))).toEqual({
      kind: 'NetworkError',
      reason: 'offline',
    });
  });

  it('handles firestore/ prefixed unavailable code', () => {
    expect(classifyFirestoreError(fbError('firestore/unavailable'))).toEqual({
      kind: 'NetworkError',
      reason: 'offline',
    });
  });
});

describe('classifyFirestoreError — transient network errors', () => {
  it('returns NetworkError:transient for deadline-exceeded', () => {
    expect(classifyFirestoreError(fbError('deadline-exceeded'))).toEqual({
      kind: 'NetworkError',
      reason: 'transient',
    });
  });

  it('returns NetworkError:transient for internal', () => {
    expect(classifyFirestoreError(fbError('internal'))).toEqual({
      kind: 'NetworkError',
      reason: 'transient',
    });
  });

  it('returns NetworkError:transient for aborted', () => {
    expect(classifyFirestoreError(fbError('aborted'))).toEqual({
      kind: 'NetworkError',
      reason: 'transient',
    });
  });
});

describe('classifyFirestoreError — auth errors', () => {
  it('returns AuthError:forbidden for permission-denied', () => {
    expect(classifyFirestoreError(fbError('permission-denied'))).toEqual({
      kind: 'AuthError',
      reason: 'forbidden',
    });
  });

  it('returns AuthError:unauthenticated for unauthenticated', () => {
    expect(classifyFirestoreError(fbError('unauthenticated'))).toEqual({
      kind: 'AuthError',
      reason: 'unauthenticated',
    });
  });
});

describe('classifyFirestoreError — storage errors', () => {
  it('returns StorageError:quota-exceeded for resource-exhausted', () => {
    expect(classifyFirestoreError(fbError('resource-exhausted'))).toEqual({
      kind: 'StorageError',
      reason: 'quota-exceeded',
    });
  });

  it('returns StorageError:corruption for data-loss', () => {
    expect(classifyFirestoreError(fbError('data-loss'))).toEqual({
      kind: 'StorageError',
      reason: 'corruption',
    });
  });
});

describe('classifyFirestoreError — fallback', () => {
  it('returns StorageError:unavailable for unknown error code', () => {
    expect(classifyFirestoreError(fbError('unknown-code'))).toEqual({
      kind: 'StorageError',
      reason: 'unavailable',
    });
  });

  it('returns StorageError:unavailable for plain Error with no code', () => {
    expect(classifyFirestoreError(new Error('oops'))).toEqual({
      kind: 'StorageError',
      reason: 'unavailable',
    });
  });

  it('returns StorageError:unavailable for null', () => {
    expect(classifyFirestoreError(null)).toEqual({
      kind: 'StorageError',
      reason: 'unavailable',
    });
  });

  it('returns StorageError:unavailable for undefined', () => {
    expect(classifyFirestoreError(undefined)).toEqual({
      kind: 'StorageError',
      reason: 'unavailable',
    });
  });
});
