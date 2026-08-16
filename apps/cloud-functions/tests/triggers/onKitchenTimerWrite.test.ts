import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KitchenTimerDoc, KitchenTimersDoc } from '@salt/domain/schemas';

// Unit-level (mock-based, no emulator) coverage of the standalone kitchen-timer
// ENQUEUE trigger (issue #842): diff the armed notify timers against the prior
// write and enqueue one Cloud Task per newly-armed timer. `KitchenTimersSchema` is
// kept REAL so the parse guard is genuinely exercised.

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockEnqueue = vi.fn(async () => undefined);
const mockTaskQueue = vi.fn(() => ({ enqueue: mockEnqueue }));
vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({ taskQueue: mockTaskQueue }),
}));

const mockReport = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);
vi.mock('@salt/observability/server', () => ({
  flushServerObservability: mockFlush,
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: mockReport })),
}));

const { onKitchenTimerWrite } = await import('../../src/triggers/onKitchenTimerWrite.js');

const T1 = '2026-08-16T18:10:00.000Z';
const T2 = '2026-08-16T18:35:00.000Z';
const UID = 'uid-1';

function timer(overrides: Partial<KitchenTimerDoc> = {}): KitchenTimerDoc {
  return {
    id: 'k1',
    label: 'Eggs',
    endsAt: T1,
    durationMinutes: 10,
    notify: true,
    ...overrides,
  };
}

function makeDoc(timers: KitchenTimerDoc[]): KitchenTimersDoc {
  return { ownerUid: UID, timers };
}

function snap(data: unknown): { exists: true; data: () => unknown } {
  return { exists: true, data: () => data };
}
const deleted = { exists: false as const, data: () => undefined };

function event(before: unknown, after: unknown, uid = UID) {
  return { data: { before, after }, params: { uid } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('onKitchenTimerWrite', () => {
  it('enqueues one task for a newly-armed timer, scheduled for its endsAt', async () => {
    await onKitchenTimerWrite(event(deleted, snap(makeDoc([timer()]))));

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      { uid: UID, timerId: 'k1', endsAt: T1 },
      { scheduleTime: new Date(T1) },
    );
  });

  // The bare form silently builds a us-central1 queue URL and every enqueue fails
  // with `Queue does not exist` — the failure that killed cook-timer pushes in
  // every environment until it was found.
  it('names the queue region-qualified', async () => {
    await onKitchenTimerWrite(event(deleted, snap(makeDoc([timer()]))));
    expect(mockTaskQueue).toHaveBeenCalledWith(
      'locations/europe-west2/functions/onKitchenTimerDispatch',
    );
  });

  it('enqueues one task per newly-armed timer', async () => {
    const doc = makeDoc([timer(), timer({ id: 'k2', endsAt: T2 })]);
    await onKitchenTimerWrite(event(deleted, snap(doc)));
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  // A whole-document write that leaves a timer untouched — dismissing a DIFFERENT
  // one, say — must not re-arm it.
  it('does not re-enqueue a timer that was already armed', async () => {
    const before = makeDoc([timer(), timer({ id: 'k2', endsAt: T2 })]);
    const after = makeDoc([timer()]);
    await onKitchenTimerWrite(event(snap(before), snap(after)));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // Re-timing changes endsAt → a new key → a new task. The OLD task no-ops on
  // dispatch because the re-read finds no timer at that end-time, which is why
  // there is no cancellation path.
  it('enqueues a fresh task when a timer is re-timed', async () => {
    const before = makeDoc([timer()]);
    const after = makeDoc([timer({ endsAt: T2 })]);
    await onKitchenTimerWrite(event(snap(before), snap(after)));

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      { uid: UID, timerId: 'k1', endsAt: T2 },
      { scheduleTime: new Date(T2) },
    );
  });

  // The task carries ids only and the handler reads the name live at send time,
  // so a rename needs no new task — and must not produce a duplicate one.
  it('enqueues nothing when a timer is renamed but not re-timed', async () => {
    const before = makeDoc([timer()]);
    const after = makeDoc([timer({ label: 'Eggs, soft' })]);
    await onKitchenTimerWrite(event(snap(before), snap(after)));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('ignores a timer too short to earn the push backstop', async () => {
    await onKitchenTimerWrite(event(deleted, snap(makeDoc([timer({ notify: false })]))));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('enqueues only the armed ones out of a mixed set', async () => {
    const doc = makeDoc([timer({ notify: false }), timer({ id: 'k2', endsAt: T2 })]);
    await onKitchenTimerWrite(event(deleted, snap(doc)));

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      { uid: UID, timerId: 'k2', endsAt: T2 },
      { scheduleTime: new Date(T2) },
    );
  });

  it('does nothing when the document was deleted', async () => {
    await onKitchenTimerWrite(event(snap(makeDoc([timer()])), deleted));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does nothing when every timer was dismissed', async () => {
    await onKitchenTimerWrite(event(snap(makeDoc([timer()])), snap(makeDoc([]))));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips an invalid document rather than throwing out of the trigger', async () => {
    await expect(
      onKitchenTimerWrite(event(deleted, snap({ ownerUid: UID, timers: [{ id: 'k1' }] }))),
    ).resolves.toBeUndefined();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // An unreadable `before` cannot prove a timer was already armed, so every armed
  // timer is treated as new. A duplicate task is deduped by the dispatch ledger; a
  // missed one is a timer that never rings.
  it('treats every armed timer as new when the prior write cannot be parsed', async () => {
    await onKitchenTimerWrite(event(snap({ nonsense: true }), snap(makeDoc([timer()]))));
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  // One failed enqueue must not fail the trigger and re-fire it, which would
  // re-enqueue the timers that DID succeed.
  it('reports a failed enqueue and still enqueues the rest', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    const doc = makeDoc([timer(), timer({ id: 'k2', endsAt: T2 })]);

    await expect(onKitchenTimerWrite(event(deleted, snap(doc)))).resolves.toBeUndefined();
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockReport).toHaveBeenCalled();
  });

  it('flushes observability on every path', async () => {
    await onKitchenTimerWrite(event(deleted, snap(makeDoc([timer()]))));
    expect(mockFlush).toHaveBeenCalled();
  });
});
