/**
 * `subscribeMembers` — the one claim the two contract nets do not hold (#928, #939).
 *
 * This file used to test the members module end to end with a mocked
 * `onSnapshot`. Almost all of that is now held, and held harder, elsewhere:
 *
 *   • `tests/subscriptionContract.emulator.test.ts` — the `subscribeMembers` row
 *     pins the EXACT delivered id set against a decoy it must exclude, the empty
 *     collection, the unsubscribe, and the corrupt-document skip together with
 *     its bound rejection log. Against a real emulator, so it says nothing about
 *     which module calls `collection()`.
 *   • `tests/writerContract.test.ts` — the `upsertMember` and `deleteMember` rows
 *     pin the exact op, path and payload with `toEqual`, the success shape, and a
 *     classified `Failure` on three separate Firestore codes.
 *
 * Those replaced tests are gone rather than repaired: re-asserting them here
 * against a hand-built snapshot double is the copied-file defect #928 exists to
 * end, and the doubles are what broke under #939's `docChanges()` in the first
 * place.
 *
 * What survives both nets is the STREAM path, and specifically its ARITY.
 * `subscribeMembers` used to be the one collection subscription whose `onError`
 * took a single argument; #928 Phase 1 deleted the `forwardsRawError` field that
 * held that divergence open, so it now forwards the raw Firestore error like the
 * other thirteen — finding B2-009, unified rather than recorded. This file pins
 * the unified arity from the outside: two arguments, the second the error the
 * SDK actually raised, so a reporting call site gets the real stack.
 *
 * It stays a unit test because the contract net cannot reach here. That net
 * asserts `rawError` only on the single-document rows' PARSE path; no row there
 * drives a collection subscription's stream callback, and provoking a real one
 * would mean revoking a security rule mid-listen. A mocked `onSnapshot` hands
 * the error callback whatever it likes, which is why this one assertion is
 * still a unit test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUnsubscribe, mockOnSnapshot, mockDoc, mockCollection, mockGetFirestore } = vi.hoisted(
  () => ({
    mockUnsubscribe: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockDoc: vi.fn(() => 'mock-doc-ref'),
    mockCollection: vi.fn(() => 'mock-collection-ref'),
    mockGetFirestore: vi.fn(() => 'mock-db'),
  }),
);

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

// The SDK boundary this package exists to wrap (UT-B3). `setDoc`/`deleteDoc` are
// declared because the module imports them, not because anything here calls
// them — the writers answer to writerContract.test.ts.
vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  doc: mockDoc,
  collection: mockCollection,
  onSnapshot: mockOnSnapshot,
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

import { subscribeMembers } from '../src/membersSubscription.js';

type ErrorCallback = (err: Error & { code?: string }) => void;

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  // classifyFirestoreError short-circuits to NetworkError/offline when
  // navigator.onLine is false; stub it online so error-code mapping is exercised.
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subscribeMembers — the stream-error path', () => {
  it('classifies a stream error and forwards the RAW error alongside it', () => {
    // Captured as an argument LIST rather than matched with
    // `toHaveBeenCalledWith`, so the arity is asserted as a value and not merely
    // satisfied by it: `toHaveBeenCalledWith(domainError, raw)` would also pass
    // on a handler that dropped the second argument on some other code path,
    // and a bare `toHaveBeenCalled` would pass on anything at all (UT-A1).
    const calls: unknown[][] = [];
    subscribeMembers(
      () => {},
      (...args) => calls.push(args),
    );

    const raw = Object.assign(new Error('denied'), { code: 'permission-denied' });
    const errCb = mockOnSnapshot.mock.calls[0]![2] as ErrorCallback;
    errCb(raw);

    // Exactly two arguments, and the second is the error the SDK raised — the
    // stack PostHog needs. One argument here is the divergence #928 Phase 1
    // closed, so this row goes red if it reopens.
    expect(calls).toEqual([[{ kind: 'AuthError', reason: 'forbidden' }, raw]]);
  });
});
