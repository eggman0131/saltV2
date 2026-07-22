import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import type { CookSessionDoc } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';

// ─── Shared report() spy ────────────────────────────────────────────────────────
// The service caches getErrorReporter() in module scope, so the adapter mock must
// hand back a STABLE report() we can assert on across tests. The mock delegates to
// the REAL category gate (isReportableCategory) so "expected failures stay quiet"
// exercises the actual report/suppress boundary rather than a forked predicate.
const { reportSpy, gatedReport } = vi.hoisted(() => {
  const reportSpy = vi.fn();
  return { reportSpy, gatedReport: reportSpy };
});

vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    isReportableCategory: actual.isReportableCategory,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        gatedReport(error, category);
      },
    })),
  };
});

// ─── Mock firebase-sync (no real Firestore in unit tests) ───────────────────────
// isAuthTransitioning is pulled in by src/lib/errorReporting.ts, not the service.
vi.mock('@salt/firebase-sync', () => ({
  subscribeCookSession: vi.fn(() => vi.fn()),
  saveCookSession: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteCookSession: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  isAuthTransitioning: vi.fn(() => false),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  cookSession,
  isLoadingCookSession,
  getCookSessionSnapshot,
  initCookSessionSync,
  persistCookSession,
  removeCookSession,
} from '../src/lib/cookSessionService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const SESSION_ID = 'recipe-1_user-1';
const OTHER_SESSION_ID = 'recipe-2_user-1';

// Old enough that any real wall-clock stamp the service writes is newer.
const OLD = '2020-01-01T00:00:00.000Z';

const STORAGE_ERR: DomainError = { kind: 'StorageError', reason: 'unavailable' };
const NETWORK_ERR: DomainError = { kind: 'NetworkError', reason: 'offline' };
const AUTH_ERR: DomainError = { kind: 'AuthError', reason: 'forbidden' };

function makeSession(overrides: Partial<CookSessionDoc> = {}): CookSessionDoc {
  return {
    id: SESSION_ID,
    schemaVersion: 1,
    ownerUid: 'user-1',
    recipeId: 'recipe-1',
    recipeUpdatedAtAtStart: OLD,
    checkedIngredientIds: [],
    completedStepIds: [],
    activeTimers: [],
    createdAt: OLD,
    updatedAt: OLD,
    ...overrides,
  };
}

type SessionCb = (session: CookSessionDoc | null) => void;
type ErrorCb = (err: DomainError, rawError?: unknown) => void;

function wireSubscription() {
  let sessionCb: SessionCb | null = null;
  let errorCb: ErrorCb | null = null;
  const unsub = vi.fn();
  fs.subscribeCookSession.mockImplementation((_id, onSession, onError) => {
    sessionCb = onSession as SessionCb;
    errorCb = onError as ErrorCb;
    return unsub;
  });
  return {
    emit: (s: CookSessionDoc | null) => sessionCb!(s),
    emitError: (err: DomainError, rawError?: unknown) => errorCb!(err, rawError),
    unsub,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  reportSpy.mockReset();
  fs.saveCookSession.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.deleteCookSession.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.isAuthTransitioning.mockReturnValue(false);
});

describe('cookSessionService — subscription', () => {
  it('watches the one deterministic session id it was given', () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);
    expect(fs.subscribeCookSession).toHaveBeenCalledTimes(1);
    expect(fs.subscribeCookSession.mock.calls[0]![0]).toBe(SESSION_ID);
  });

  it('stays in a loading state until the first snapshot arrives', () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    expect(get(isLoadingCookSession)).toBe(true);
    emit(null);
    expect(get(isLoadingCookSession)).toBe(false);
  });

  it('makes an incoming snapshot the session the page cooks from', () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    const doc = makeSession({ checkedIngredientIds: ['ing-1'] });
    emit(doc);
    expect(get(cookSession)).toEqual(doc);
    expect(getCookSessionSnapshot()).toEqual(doc);
  });

  it('reports no session to resume when the document does not exist', () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(null);
    expect(get(cookSession)).toBeNull();
  });

  it('hands back the unsubscribe the adapter created, for the page to dispose', () => {
    const { unsub } = wireSubscription();
    const dispose = initCookSessionSync(SESSION_ID);
    expect(dispose).toBe(unsub);
  });
});

describe('cookSessionService — optimistic writes', () => {
  it('shows a local edit before the write has reached Firestore', async () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(makeSession());

    let settle: (r: ReadResult<void, DomainError>) => void = () => {};
    fs.saveCookSession.mockReturnValue(
      new Promise<ReadResult<void, DomainError>>((resolve) => {
        settle = resolve;
      }),
    );

    const pending = persistCookSession(makeSession({ checkedIngredientIds: ['ing-1'] }));
    // Still in flight — the store must already reflect the tick.
    expect(getCookSessionSnapshot()?.checkedIngredientIds).toEqual(['ing-1']);
    expect(fs.saveCookSession).toHaveBeenCalledTimes(1);

    settle({ kind: 'ok', value: undefined });
    await expect(pending).resolves.toEqual({ kind: 'ok', value: undefined });
  });

  it('stamps a fresh updatedAt instead of trusting the caller’s', async () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);

    await persistCookSession(makeSession({ updatedAt: OLD }));

    const saved = fs.saveCookSession.mock.calls[0]![0]!;
    expect(saved.updatedAt).not.toBe(OLD);
    expect(saved.updatedAt > OLD).toBe(true);
    expect(getCookSessionSnapshot()?.updatedAt).toBe(saved.updatedAt);
  });

  it('persists the whole document, not a patch of the changed field', async () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);

    const doc = makeSession({ checkedIngredientIds: ['ing-1'], completedStepIds: ['step-1'] });
    await persistCookSession(doc);

    const saved = fs.saveCookSession.mock.calls[0]![0]!;
    expect(saved).toEqual({ ...doc, updatedAt: saved.updatedAt });
  });

  it('clears the session locally the moment it is deleted', async () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(makeSession());

    await removeCookSession(SESSION_ID);

    expect(getCookSessionSnapshot()).toBeNull();
    expect(fs.deleteCookSession).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe('cookSessionService — last-write-wins guard', () => {
  it('never rolls a local edit back to a snapshot that predates it', async () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(makeSession({ checkedIngredientIds: [] }));

    await persistCookSession(makeSession({ checkedIngredientIds: ['ing-1'] }));
    expect(getCookSessionSnapshot()?.checkedIngredientIds).toEqual(['ing-1']);

    // In-flight echo of the pre-edit document.
    emit(makeSession({ checkedIngredientIds: [], updatedAt: OLD }));
    expect(getCookSessionSnapshot()?.checkedIngredientIds).toEqual(['ing-1']);
  });

  it('accepts a snapshot newer than the local edit, so another device wins', async () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(makeSession());

    await persistCookSession(makeSession({ checkedIngredientIds: ['ing-1'] }));

    const fromOtherDevice = makeSession({
      checkedIngredientIds: ['ing-1', 'ing-2'],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    emit(fromOtherDevice);
    expect(getCookSessionSnapshot()).toEqual(fromOtherDevice);
  });

  it('keeps a just-created session when the snapshot has not caught up', async () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(null); // no session yet

    await persistCookSession(makeSession({ checkedIngredientIds: ['ing-1'] }));

    // The create has not echoed back yet: the doc still reads as absent.
    emit(null);
    expect(getCookSessionSnapshot()?.checkedIngredientIds).toEqual(['ing-1']);
  });

  it('cannot have a deleted session resurrected by a late snapshot', async () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(makeSession({ checkedIngredientIds: ['ing-1'] }));

    await removeCookSession(SESSION_ID);

    // A snapshot still in flight when the delete landed.
    emit(makeSession({ checkedIngredientIds: ['ing-1'], updatedAt: OLD }));
    expect(getCookSessionSnapshot()).toBeNull();
  });

  // The guard that protects an un-echoed create also holds a session the cook is
  // already in against a later "document absent" snapshot: once ANY snapshot has
  // been accepted for this id, the id is watermarked. Only the local Complete /
  // Restart path (removeCookSession) clears it — a delete from another device
  // lands on the next initCookSessionSync. Pinned deliberately: an in-progress
  // cook must never blank out mid-recipe.
  it('holds on to the session in progress when a later snapshot says the document is gone', () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    const doc = makeSession({ checkedIngredientIds: ['ing-1'] });
    emit(doc);

    emit(null);
    expect(getCookSessionSnapshot()).toEqual(doc);
  });
});

describe('cookSessionService — re-subscribing', () => {
  it('starts a different session from an empty, loading state', () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(makeSession({ checkedIngredientIds: ['ing-1'] }));

    initCookSessionSync(OTHER_SESSION_ID);

    expect(getCookSessionSnapshot()).toBeNull();
    expect(get(isLoadingCookSession)).toBe(true);
    expect(fs.subscribeCookSession.mock.calls[1]![0]).toBe(OTHER_SESSION_ID);

    const other = makeSession({ id: OTHER_SESSION_ID, recipeId: 'recipe-2' });
    emit(other);
    expect(getCookSessionSnapshot()).toEqual(other);
  });

  it('forgets the previous local-edit watermark when it re-subscribes', async () => {
    const { emit } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    emit(makeSession());
    await persistCookSession(makeSession({ checkedIngredientIds: ['ing-1'] }));

    // Re-entering the same cook: the stored document is authoritative again,
    // even though it predates the edit made in the previous subscription.
    initCookSessionSync(SESSION_ID);
    emit(makeSession({ checkedIngredientIds: [], updatedAt: OLD }));
    expect(getCookSessionSnapshot()?.checkedIngredientIds).toEqual([]);
  });
});

describe('cookSessionService — failures', () => {
  it('surfaces a failed write as a Failure rather than throwing', async () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);
    fs.saveCookSession.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });

    const result = await persistCookSession(makeSession());

    expect(result).toEqual({ kind: 'err', error: STORAGE_ERR });
    expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
  });

  it('surfaces a failed delete as a Failure rather than throwing', async () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);
    fs.deleteCookSession.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });

    const result = await removeCookSession(SESSION_ID);

    expect(result).toEqual({ kind: 'err', error: STORAGE_ERR });
    expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
  });

  it('keeps the optimistic edit on screen when the write fails, so the cook is not disrupted', async () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);
    fs.saveCookSession.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });

    await persistCookSession(makeSession({ checkedIngredientIds: ['ing-1'] }));

    expect(getCookSessionSnapshot()?.checkedIngredientIds).toEqual(['ing-1']);
  });

  it('does not report an offline write failure — that one is expected', async () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);
    fs.saveCookSession.mockResolvedValueOnce({ kind: 'err', error: NETWORK_ERR });

    await persistCookSession(makeSession());

    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('does not report a successful write', async () => {
    wireSubscription();
    initCookSessionSync(SESSION_ID);
    await persistCookSession(makeSession());
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('reports a subscription error and stops showing the loading state', () => {
    const { emitError } = wireSubscription();
    initCookSessionSync(SESSION_ID);

    emitError(STORAGE_ERR);

    expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    expect(get(isLoadingCookSession)).toBe(false);
  });

  it('forwards the adapter’s raw error when it has one, for the real stack', () => {
    const { emitError } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    const raw = new Error('firestore exploded');

    emitError(STORAGE_ERR, raw);

    expect(reportSpy).toHaveBeenCalledWith(raw, 'StorageError');
  });

  it('does not report the permission-denied noise of a sign-out teardown', () => {
    const { emitError } = wireSubscription();
    initCookSessionSync(SESSION_ID);
    fs.isAuthTransitioning.mockReturnValue(true);

    emitError(AUTH_ERR);

    expect(reportSpy).not.toHaveBeenCalled();
  });
});
