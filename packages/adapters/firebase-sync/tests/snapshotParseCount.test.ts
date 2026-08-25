/**
 * The regression guard for `docChanges()` (issue #939).
 *
 * `subscribeCollection` keeps what each document came to, by id, and re-parses
 * only the ids `snap.docChanges()` names — N parses on the first snapshot, one
 * per ordinary write thereafter, none at all when nothing changed. That is the
 * entire claim of the perf commit, and NOTHING ELSE IN THE SUITE CAN SEE IT.
 * `subscriptionContract.emulator.test.ts` asserts the delivered SET, which is
 * identical whether the listener parses one document or all of them, so a future
 * edit could restore the O(N)-per-snapshot walk and leave every existing test
 * green. This file counts the parses instead.
 *
 * ─── Why `subscribeMyCookSessions` and not a stub ───────────────────────────
 *
 * The count is taken by spying on the REAL `CookSessionSchema.safeParse`, driven
 * through the REAL exported subscription, because the two things that could go
 * wrong here are things a stub would hide:
 *
 *   • ORDER. `subscribeMyCookSessions` is one of the two subscriptions whose
 *     order is load-bearing (`orderBy('updatedAt','desc')` + `limit(5)`; the
 *     other is `subscribeBatchObservations`). The source takes order from
 *     `snap.docs` on purpose, and the alternative the Firestore docs show —
 *     splicing a local array by `oldIndex`/`newIndex` — is one off-by-one away
 *     from reordering it silently and permanently. The moved-document case below
 *     is what fails on that implementation: a session whose own `updatedAt` was
 *     bumped travels from the back of the window to the front.
 *   • THE REFUSAL CACHE. A document the schema rejects is cached as a refusal
 *     rather than forgotten. If it were forgotten it would be re-parsed and
 *     re-logged on every snapshot for as long as it sat there — and, worse, an
 *     implementation that cached only the ACCEPTED documents would resurrect it.
 *
 * ─── What the snapshot double does, and what it refuses to do ───────────────
 *
 * `nextSnapshot` below is not a hand-written `docChanges()` list. It is given the
 * collection as the query would order it and DERIVES the changes by diffing
 * against the snapshot before it, which is what Firestore itself does: a document
 * absent from the new state is `removed`, one absent from the old is `added`, one
 * present in both whose contents differ is `modified`, and one present in both
 * unchanged produces no entry at all. Nothing is asserted by the fixture; the
 * states are the script and the changes fall out of them.
 *
 * `oldIndex`/`newIndex` are the document's place in the previous and next
 * snapshot. The code under test reads NEITHER — that is the point of the source's
 * "order still comes from `snap.docs`" note — so an implementation that starts
 * reading them is exactly the one this file is here to redden.
 *
 * (The five per-collection files carry a `firstSnapshot(docs)` helper, which is
 * this driver's first call and nothing more. It is not shared from here because
 * `firebase-sync` has no `tests/support/` and creating one to hold a four-line
 * helper is a bigger change than the duplication it removes — UT-C4.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUnsubscribe, mockOnSnapshot, mockCollection, mockGetFirestore, mockQuery } = vi.hoisted(
  () => ({
    mockUnsubscribe: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockCollection: vi.fn(() => 'mock-collection-ref'),
    mockGetFirestore: vi.fn(() => 'mock-db'),
    mockQuery: vi.fn(() => 'mock-query-ref'),
  }),
);

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

// The SDK boundary (UT-B3). `doc`/`setDoc`/`deleteDoc`/`getDoc` are declared only
// because the module under test imports them; the writers answer to
// writerContract.test.ts. `where`/`orderBy`/`limit` return the marker the
// subscription hands to `query`, so the constraint the window depends on stays
// visible to the assertions below.
vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: mockCollection,
  query: mockQuery,
  where: vi.fn((field: string, op: string, value: unknown) => ({ where: [field, op, value] })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  limit: vi.fn((n: number) => ({ limit: n })),
  doc: vi.fn(() => 'mock-doc-ref'),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: mockOnSnapshot,
}));

import { subscribeMyCookSessions } from '../src/cookSessionSubscription.js';
import { makeFreshSession } from '@salt/domain';
import { CookSessionSchema } from '@salt/domain/schemas';
import type { CookSessionDoc } from '@salt/domain/schemas';

// ─── The snapshot double ─────────────────────────────────────────────────────

type SnapDoc = { id: string; data: () => unknown };
type ChangeType = 'added' | 'modified' | 'removed';
interface DocChangeDouble {
  type: ChangeType;
  doc: SnapDoc;
  oldIndex: number;
  newIndex: number;
}
interface QuerySnapshotDouble {
  docs: SnapDoc[];
  docChanges: () => DocChangeDouble[];
}

/** One document as the collection holds it, before the SDK wraps it. */
interface StoredDoc {
  readonly id: string;
  readonly data: unknown;
}

const asSnapDoc = (d: StoredDoc): SnapDoc => ({ id: d.id, data: () => d.data });

/**
 * A snapshot sequence. Each call is handed the whole collection in query order
 * and returns the `QuerySnapshot` Firestore would deliver for it, `docChanges()`
 * derived by diffing against the call before.
 */
function snapshotSequence(): (next: readonly StoredDoc[]) => QuerySnapshotDouble {
  let previous: readonly StoredDoc[] = [];
  return (next) => {
    const before = previous;
    const after = [...next];
    const changes: DocChangeDouble[] = [];
    before.forEach((d, oldIndex) => {
      if (!after.some((n) => n.id === d.id)) {
        changes.push({ type: 'removed', doc: asSnapDoc(d), oldIndex, newIndex: -1 });
      }
    });
    after.forEach((d, newIndex) => {
      const oldIndex = before.findIndex((p) => p.id === d.id);
      if (oldIndex === -1) {
        changes.push({ type: 'added', doc: asSnapDoc(d), oldIndex: -1, newIndex });
      } else if (JSON.stringify(before[oldIndex]?.data) !== JSON.stringify(d.data)) {
        changes.push({ type: 'modified', doc: asSnapDoc(d), oldIndex, newIndex });
      }
    });
    previous = after;
    return { docs: after.map(asSnapDoc), docChanges: () => changes };
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UID = 'user-1';
const START = '2026-08-01T00:00:00.000Z';

// UT-C2: the real domain builder, not a hand-rolled literal.
function cookSession(recipeId: string, updatedAt: string): CookSessionDoc {
  return {
    ...makeFreshSession({
      id: `${recipeId}_${UID}`,
      ownerUid: UID,
      recipeId,
      recipeUpdatedAtAtStart: START,
      nowIso: START,
    }),
    updatedAt,
  };
}

const row = (session: CookSessionDoc): StoredDoc => ({ id: session.id, data: session });

const A = cookSession('r1', '2026-08-24T12:00:00.000Z');
const B = cookSession('r2', '2026-08-23T12:00:00.000Z');
const C = cookSession('r3', '2026-08-22T12:00:00.000Z');
const D = cookSession('r4', '2026-08-21T12:00:00.000Z');
const E = cookSession('r5', '2026-08-25T12:00:00.000Z');
const F = cookSession('r6', '2026-08-26T12:00:00.000Z');

/** D, written again — so `orderBy('updatedAt','desc')` moves it to the front. */
const D_BUMPED: CookSessionDoc = { ...D, updatedAt: '2026-08-27T12:00:00.000Z' };

/** `schemaVersion` is `z.literal(1)`, so the schema refuses this outright. */
const CORRUPT: StoredDoc = { id: 'broken_user-1', data: { id: 'broken_user-1', schemaVersion: 2 } };

// Newest first, which is the order the query imposes and the order the
// subscription must deliver.
const BASE = [row(A), row(B), row(C), row(D)];

// ─── Harness ─────────────────────────────────────────────────────────────────

let parseSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/**
 * Attach the real subscription, deliver `initial` as its first snapshot, and
 * return the levers: `deliver` pushes the next whole-collection state through,
 * `latest` is what the subscriber last received.
 */
function attach(initial: readonly StoredDoc[]) {
  const deliveries: CookSessionDoc[][] = [];
  subscribeMyCookSessions(
    UID,
    (sessions) => deliveries.push(sessions),
    () => {},
  );
  const emit = mockOnSnapshot.mock.calls[0]?.[1] as (snap: QuerySnapshotDouble) => void;
  const nextSnapshot = snapshotSequence();
  const deliver = (rows: readonly StoredDoc[]) => emit(nextSnapshot(rows));
  deliver(initial);
  return {
    deliveries,
    deliver,
    latest: () => deliveries[deliveries.length - 1] ?? [],
    ids: () => (deliveries[deliveries.length - 1] ?? []).map((s) => s.id),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  parseSpy = vi.spyOn(CookSessionSchema, 'safeParse');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  parseSpy.mockRestore();
  errorSpy.mockRestore();
});

// ─── The counts ──────────────────────────────────────────────────────────────

describe('subscribeMyCookSessions — how many documents a snapshot parses (#939)', () => {
  it('parses every document on the first snapshot', () => {
    const live = attach(BASE);

    expect(parseSpy).toHaveBeenCalledTimes(BASE.length);
    expect(live.ids()).toEqual([A.id, B.id, C.id, D.id]);
  });

  it('parses exactly one document when one document is modified', () => {
    const live = attach(BASE);
    parseSpy.mockClear();

    live.deliver([row(D_BUMPED), row(A), row(B), row(C)]);

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy.mock.calls[0]?.[0]).toEqual(D_BUMPED);
    expect(live.latest()).toContainEqual(D_BUMPED);
  });

  it('parses exactly one document when a document is added to an existing set', () => {
    const live = attach(BASE);
    parseSpy.mockClear();

    live.deliver([row(E), row(A), row(B), row(C), row(D)]);

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy.mock.calls[0]?.[0]).toEqual(E);
    expect(live.ids()).toEqual([E.id, A.id, B.id, C.id, D.id]);
  });

  it('parses no documents when a document is removed', () => {
    const live = attach(BASE);
    parseSpy.mockClear();

    live.deliver([row(A), row(C), row(D)]);

    expect(parseSpy).toHaveBeenCalledTimes(0);
    expect(live.ids()).toEqual([A.id, C.id, D.id]);
  });

  it('parses no documents when a snapshot reports nothing changed', () => {
    const live = attach(BASE);
    const first = live.latest();
    parseSpy.mockClear();

    live.deliver(BASE);

    expect(parseSpy).toHaveBeenCalledTimes(0);
    expect(live.ids()).toEqual([A.id, B.id, C.id, D.id]);
    // The same objects, not merely equal ones: proof the delivery came off the
    // cache rather than from a re-parse that happened to agree.
    live.latest().forEach((session, i) => expect(session).toBe(first[i]));
  });

  it('parses only the arrival when a new document pushes the oldest out of the limit window', () => {
    // Seeded at the full window, so the sixth session displaces the fifth — the
    // case that needs no removal branch at all, because the departing document is
    // simply absent from `snap.docs`.
    const live = attach([row(E), row(A), row(B), row(C), row(D)]);
    parseSpy.mockClear();

    live.deliver([row(F), row(E), row(A), row(B), row(C)]);

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy.mock.calls[0]?.[0]).toEqual(F);
    expect(live.ids()).toEqual([F.id, E.id, A.id, B.id, C.id]);
  });
});

// ─── The order the cache must not touch ──────────────────────────────────────

describe('subscribeMyCookSessions — the cache does not reorder (#939)', () => {
  it('reads the window from the query the subscription built', () => {
    attach(BASE);

    expect(mockQuery).toHaveBeenCalledWith(
      'mock-collection-ref',
      { where: ['ownerUid', '==', UID] },
      { orderBy: ['updatedAt', 'desc'] },
      { limit: 5 },
    );
  });

  it('delivers the order the snapshot reports when a modified document moves to the front', () => {
    const live = attach(BASE);
    expect(live.ids()).toEqual([A.id, B.id, C.id, D.id]);

    // D was written again, so `orderBy('updatedAt','desc')` carries it from the
    // back of the window to the front. An implementation that spliced a cached
    // array by `oldIndex`/`newIndex`, or that rebuilt a Map in first-seen order,
    // delivers the old order here and nothing else in the suite notices.
    live.deliver([row(D_BUMPED), row(A), row(B), row(C)]);

    expect(live.ids()).toEqual([D.id, A.id, B.id, C.id]);
  });

  it('delivers the surviving order unchanged across an add and a remove', () => {
    const live = attach(BASE);

    live.deliver([row(E), row(A), row(B), row(C), row(D)]);
    expect(live.ids()).toEqual([E.id, A.id, B.id, C.id, D.id]);

    live.deliver([row(E), row(A), row(C), row(D)]);
    expect(live.ids()).toEqual([E.id, A.id, C.id, D.id]);
  });

  it('delivers an unchanged document as the same object across a neighbour changing', () => {
    const live = attach(BASE);
    const firstA = live.latest()[0];

    live.deliver([row(D_BUMPED), row(A), row(B), row(C)]);

    const secondA = live.latest().find((s) => s.id === A.id);
    expect(secondA).toBe(firstA);
    // …and the document that DID change is a fresh parse, not the cached one.
    expect(live.latest()[0]).not.toBe(firstA);
    expect(live.latest()[0]).toEqual(D_BUMPED);
  });
});

// ─── The refusal, cached ─────────────────────────────────────────────────────

describe('subscribeMyCookSessions — a refused document stays refused (#939)', () => {
  const WITH_CORRUPT = [row(A), CORRUPT, row(B)];

  it('skips the document its schema refused and logs it once', () => {
    const live = attach(WITH_CORRUPT);

    expect(live.ids()).toEqual([A.id, B.id]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      `[CookSessionSchema] Document ${CORRUPT.id} failed validation`,
    );
  });

  it('keeps it skipped, and does not log it again, when a different document changes', () => {
    const live = attach(WITH_CORRUPT);
    parseSpy.mockClear();
    errorSpy.mockClear();

    live.deliver([row(A), CORRUPT, row({ ...B, updatedAt: '2026-08-28T12:00:00.000Z' })]);

    // One parse — B's. The refusal came off the cache, so the corrupt document
    // cost neither a parse nor a second identical line on the console.
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(0);
    expect(live.ids()).toEqual([A.id, B.id]);
  });

  it('re-parses the refused document, and logs it again, when it changes and is still corrupt', () => {
    const live = attach(WITH_CORRUPT);
    parseSpy.mockClear();
    errorSpy.mockClear();

    // Edited, still invalid: `schemaVersion` is `z.literal(1)` and this is 3. The
    // cached refusal is keyed on the id, so a write to that id must invalidate it
    // — a cache that kept the refusal because the id had already failed once
    // would never notice the document being repaired.
    const STILL_CORRUPT: StoredDoc = {
      id: CORRUPT.id,
      data: { id: CORRUPT.id, schemaVersion: 3 },
    };
    live.deliver([row(A), STILL_CORRUPT, row(B)]);

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy.mock.calls[0]?.[0]).toEqual(STILL_CORRUPT.data);
    // The second line is the point: a document that is corrupt again is a fresh
    // fact about a fresh write, not the same one repeated per snapshot.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      `[CookSessionSchema] Document ${CORRUPT.id} failed validation`,
    );
    expect(live.ids()).toEqual([A.id, B.id]);
  });

  it('re-parses the refused document, and delivers it, once it is written valid', () => {
    const live = attach(WITH_CORRUPT);
    parseSpy.mockClear();
    errorSpy.mockClear();

    const REPAIRED = cookSession('broken', '2026-08-29T12:00:00.000Z');
    const repairedRow: StoredDoc = { id: CORRUPT.id, data: REPAIRED };
    live.deliver([row(A), repairedRow, row(B)]);

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(0);
    expect(live.ids()).toEqual([A.id, REPAIRED.id, B.id]);
  });
});
