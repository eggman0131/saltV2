/**
 * `kitchenTimerService` — what a corrupt `kitchenTimers/{uid}` does to the store
 * (#928 Phase 2).
 *
 * `subscribeKitchenTimers` used to answer a document its schema refused with
 * `null`, the same thing it delivers for a document that does not exist — and
 * absence is the ORDINARY state here, since the document is not written until
 * the member starts their first timer. So a corrupt document was indistinguish-
 * able from a fresh account: the store went empty, `getKitchenTimersSnapshot`
 * synthesised a blank document, and the next start wrote it over the corruption
 * with no record that anything had been refused. It is a
 * `StorageError`/`corruption` on `onError` now, and this file is the pin.
 *
 * The absent-document behaviour is asserted alongside it, because the two arrive
 * at the same store and only the adapter tells them apart — a change that
 * "fixed" corruption by breaking the empty-account path would be worse than the
 * defect.
 */
import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import type { KitchenTimersDoc } from '@salt/domain/schemas';
import type { DomainError } from '@salt/shared-types';

// ─── Shared report() spy ────────────────────────────────────────────────────────
// The service caches getErrorReporter() in module scope, so the adapter mock must
// hand back a STABLE report(). It delegates to the REAL category gate, so a row
// asserting "this was reported" exercises the actual §7.6 boundary rather than a
// forked predicate.
const { reportSpy } = vi.hoisted(() => ({ reportSpy: vi.fn() }));

vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    isReportableCategory: actual.isReportableCategory,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        reportSpy(error, category);
      },
    })),
  };
});

// The SDK boundary this service sits behind (UT-B3). `isAuthTransitioning` is
// pulled in by src/lib/errorReporting.ts, not by the service itself.
vi.mock('@salt/firebase-sync', () => ({
  subscribeKitchenTimers: vi.fn(() => vi.fn()),
  saveKitchenTimers: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  isAuthTransitioning: vi.fn(() => false),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  kitchenTimers,
  getKitchenTimersSnapshot,
  initKitchenTimerSync,
} from '../src/lib/kitchenTimerService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const UID = 'user-1';

function makeTimers(overrides: Partial<KitchenTimersDoc> = {}): KitchenTimersDoc {
  return {
    ownerUid: UID,
    timers: [
      {
        id: 'timer-1',
        label: 'Eggs',
        durationSeconds: 360,
        startedAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-01T00:06:00.000Z',
        state: 'running',
      },
    ],
    ...overrides,
  } as KitchenTimersDoc;
}

// Capture the two callbacks the service hands the adapter, so a test can drive
// the snapshot and the error path directly.
function wireSubscription() {
  let onDoc!: (d: KitchenTimersDoc | null) => void;
  let onError!: (err: DomainError, rawError?: unknown) => void;
  const unsub = vi.fn();
  fs.subscribeKitchenTimers.mockImplementation((_uid, doc, err) => {
    onDoc = doc;
    onError = err;
    return unsub;
  });
  return {
    unsub,
    emit: (d: KitchenTimersDoc | null) => onDoc(d),
    emitError: (err: DomainError, rawError?: unknown) => onError(err, rawError),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  reportSpy.mockReset();
  fs.isAuthTransitioning.mockReturnValue(false);
});

describe('kitchenTimerService — a document the schema refused', () => {
  it('keeps the timers it holds and reports the corruption', () => {
    const { emit, emitError } = wireSubscription();
    const dispose = initKitchenTimerSync(UID);
    const held = makeTimers();
    emit(held);

    // No rawError: the corruption Failure comes from the PARSE, which has no
    // Firestore error behind it. Passing one would test a call the adapter never
    // makes.
    emitError({ kind: 'StorageError', reason: 'corruption' });

    expect(get(kitchenTimers)).toEqual(held);
    expect(getKitchenTimersSnapshot()).toEqual(held);
    // The payload, not merely that a spy fired (UT-A1). `StorageError` is a
    // reported category under §7.6 — which is the whole gain here: the
    // corruption is visible instead of silent.
    expect(reportSpy).toHaveBeenCalledWith(
      { kind: 'StorageError', reason: 'corruption' },
      'StorageError',
    );
    dispose();
  });

  it('still synthesises an empty document for a member who has never started one', () => {
    const { emit } = wireSubscription();
    const dispose = initKitchenTimerSync(UID);

    emit(null);

    expect(get(kitchenTimers)).toBeNull();
    // The absent document is the ordinary state on a fresh account, so the
    // snapshot is a blank document rather than null — and nothing is reported.
    expect(getKitchenTimersSnapshot()).toEqual({ ownerUid: UID, timers: [] });
    expect(reportSpy).not.toHaveBeenCalled();
    dispose();
  });
});
