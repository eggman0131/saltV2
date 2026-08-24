import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CookSessionDoc, CookActiveTimerDoc } from '@salt/domain/schemas';

// Unit-level (mock-based, no emulator) coverage of the cook-timer ENQUEUE trigger
// (issue #544): diff armed notify timers against the prior write and enqueue one
// Cloud Task per newly-armed timer. CookSessionSchema is kept REAL so the parse
// guard is genuinely exercised.

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

const mockFlush = vi.fn().mockResolvedValue(undefined);
vi.mock('@salt/observability/server', async (importOriginal) => ({
  // Spread the real module so an export the ENTRYPOINT WRAPPER needs
  // (runWithSuppliedTraceContext) cannot go missing from this mock the way it
  // did when the wrapper landed — a one-export factory is exactly what goes
  // stale. Only the calls this suite asserts on are overridden below.
  ...((await importOriginal()) as Record<string, unknown>),
  flushServerObservability: mockFlush,
  // reportServerError.js constructs this at module load — it must exist on the mock.
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

const { onCookTimerWrite } = await import('../../src/triggers/onCookTimerWrite.js');

const T1 = '2026-07-24T10:00:00.000Z';
const T2 = '2026-07-24T10:05:00.000Z';

function timer(overrides: Partial<CookActiveTimerDoc> = {}): CookActiveTimerDoc {
  return {
    id: 'step-1',
    stepId: 'step-1',
    label: null,
    durationMinutes: null,
    endsAt: T1,
    notify: true,
    ...overrides,
  };
}

function makeSession(timers: CookActiveTimerDoc[]): CookSessionDoc {
  return {
    id: 'recipe-1_uid-1',
    schemaVersion: 1,
    ownerUid: 'uid-1',
    recipeId: 'recipe-1',
    recipeUpdatedAtAtStart: '2026-07-24T09:00:00.000Z',
    checkedIngredientIds: [],
    completedStepIds: [],
    activeTimers: timers,
    createdAt: '2026-07-24T09:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
  };
}

function snap(data: unknown): { exists: true; data: () => unknown } {
  return { exists: true, data: () => data };
}
const deleted = { exists: false as const, data: () => undefined };

function event(before: unknown, after: unknown, sessionId = 'recipe-1_uid-1') {
  return { data: { before, after }, params: { sessionId } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('onCookTimerWrite', () => {
  it('enqueues one task for a newly-added notify timer', async () => {
    const before = snap(makeSession([]));
    const after = snap(makeSession([timer()]));

    await (onCookTimerWrite as unknown as Function)(event(before, after));

    // REGION-QUALIFIED, not the bare name: firebase-admin falls back to
    // us-central1 for an unqualified name rather than inheriting the calling
    // function's region, which made every real enqueue 404 on a queue that only
    // exists in europe-west2. Asserting the qualified form keeps that from
    // silently regressing (the mock can't tell us the queue was wrong).
    expect(mockTaskQueue).toHaveBeenCalledWith(
      'locations/europe-west2/functions/onCookTimerDispatch',
    );
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      { sessionId: 'recipe-1_uid-1', timerId: 'step-1', endsAt: T1 },
      { scheduleTime: new Date(T1) },
    );
  });

  it('does NOT enqueue for a notify:false timer', async () => {
    const before = snap(makeSession([]));
    const after = snap(makeSession([timer({ notify: false })]));

    await (onCookTimerWrite as unknown as Function)(event(before, after));

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does NOT re-enqueue a timer already present in before (same id@endsAt)', async () => {
    const before = snap(makeSession([timer()]));
    const after = snap(makeSession([timer()]));

    await (onCookTimerWrite as unknown as Function)(event(before, after));

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('enqueues for an ADJUSTED timer (same id, different endsAt → new key)', async () => {
    const before = snap(makeSession([timer({ endsAt: T1 })]));
    const after = snap(makeSession([timer({ endsAt: T2 })]));

    await (onCookTimerWrite as unknown as Function)(event(before, after));

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      { sessionId: 'recipe-1_uid-1', timerId: 'step-1', endsAt: T2 },
      { scheduleTime: new Date(T2) },
    );
  });

  it('enqueues under the timer id, which is NOT the step id for an ad-hoc timer', async () => {
    const before = snap(makeSession([]));
    const after = snap(makeSession([timer({ id: 'adhoc-1', stepId: null })]));

    await (onCookTimerWrite as unknown as Function)(event(before, after));

    expect(mockEnqueue).toHaveBeenCalledWith(
      { sessionId: 'recipe-1_uid-1', timerId: 'adhoc-1', endsAt: T1 },
      { scheduleTime: new Date(T1) },
    );
  });

  it('BACK-COMPAT: a legacy timer entry enqueues under its backfilled id', async () => {
    // A session written before #748 (no id/label/durationMinutes) and still live
    // across the deploy. The schema backfills `id` from `stepId`.
    const before = snap(makeSession([]));
    const after = snap({
      ...makeSession([]),
      activeTimers: [{ stepId: 'step-1', endsAt: T1, notify: true }],
    });

    await (onCookTimerWrite as unknown as Function)(event(before, after));

    expect(mockEnqueue).toHaveBeenCalledWith(
      { sessionId: 'recipe-1_uid-1', timerId: 'step-1', endsAt: T1 },
      { scheduleTime: new Date(T1) },
    );
  });

  it('returns without enqueue when the after doc is deleted', async () => {
    const before = snap(makeSession([timer()]));

    await (onCookTimerWrite as unknown as Function)(event(before, deleted));

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockTaskQueue).not.toHaveBeenCalled();
  });
});
