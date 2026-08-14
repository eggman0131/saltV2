import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BatchDoc, BatchStageDoc } from '@salt/domain/schemas';

// Unit-level (mock-based, no emulator) coverage of the batch stage-reminder ENQUEUE
// trigger (issue #812, phase 3 of epic #778): work out which stages earn a
// notification, diff them against the prior write, and enqueue one Cloud Task each.
// BatchSchema and `remindableStages` are kept REAL, so the parse guard and the
// reminder rule are both genuinely exercised here as well as in the domain suite.

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
  // reportServerError.js constructs this at module load — it must exist on the mock.
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: mockReport })),
}));

const { onBatchWritten } = await import('../../src/triggers/onBatchWritten.js');

const BATCH_ID = 'batch-1';
// "Now" for every test. The trigger reads the clock exactly once (the horizon and
// past-time guards), so freezing it makes every planned time below checkable by hand.
const NOW = new Date('2026-08-14T18:00:00.000Z');
const at = (offsetMinutes: number) =>
  new Date(NOW.getTime() + offsetMinutes * 60_000).toISOString();

// The epic's overnight loaf, on a clock: mix(active), bulk(wait), shape(active),
// retard(wait), preheat(wait), bake(active). Remindable: mix, shape, preheat, bake.
const LOAF: Array<[string, 'active' | 'wait', number]> = [
  ['mix', 'active', 60],
  ['bulk', 'wait', 80],
  ['shape', 'active', 260],
  ['retard', 'wait', 275],
  ['preheat', 'wait', 755],
  ['bake', 'active', 775],
];

function stage(
  id: string,
  kind: 'active' | 'wait',
  startOffsetMinutes: number,
  overrides: Partial<BatchStageDoc> = {},
): BatchStageDoc {
  return {
    id,
    label: id,
    kind,
    environment: null,
    duration: { kind: 'fixed', minutes: 20 },
    until: null,
    stepId: null,
    plannedStartAt: at(startOffsetMinutes),
    plannedEndAt: at(startOffsetMinutes + 20),
    actualStartAt: null,
    actualEndAt: null,
    ...overrides,
  };
}

const loafStages = (): BatchStageDoc[] => LOAF.map(([id, kind, off]) => stage(id, kind, off));

function makeBatch(overrides: Partial<BatchDoc> = {}): BatchDoc {
  return {
    id: BATCH_ID,
    schemaVersion: 1,
    recipeId: 'recipe-1',
    recipeTitle: 'Overnight white tin',
    state: 'running',
    quantities: [],
    totals: { basisGrams: 1000, totalGrams: 1700, usableGrams: 1700, units: null },
    stages: loafStages(),
    rationale: null,
    createdAt: '2026-08-14T17:00:00.000Z',
    updatedAt: '2026-08-14T17:00:00.000Z',
    ...overrides,
  };
}

function snap(data: unknown): { exists: true; data: () => unknown } {
  return { exists: true, data: () => data };
}
const deleted = { exists: false as const, data: () => undefined };

function event(before: unknown, after: unknown, batchId = BATCH_ID) {
  return { data: { before, after }, params: { batchId } };
}

const enqueuedStageIds = () =>
  mockEnqueue.mock.calls.map((call) => (call as unknown as [{ stageId: string }])[0].stageId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('onBatchWritten — which stages get a task', () => {
  it('enqueues the loaf reminders and NOTHING for the overnight retard', async () => {
    // The pinning behaviour of the whole phase, end to end through the trigger:
    // mix, shape, preheat, bake — and silence across the eight hours in the fridge.
    await (onBatchWritten as unknown as Function)(event(deleted, snap(makeBatch())));

    expect(enqueuedStageIds()).toEqual(['mix', 'shape', 'preheat', 'bake']);
  });

  it('region-qualifies the queue name', async () => {
    // firebase-admin parses a BARE name with no location and falls back to
    // us-central1 rather than inheriting the caller's region — which built a
    // us-central1 queue URL for the cook timer and killed every push in every
    // environment. The mock cannot tell us the queue was wrong, so pin the string.
    await (onBatchWritten as unknown as Function)(event(deleted, snap(makeBatch())));

    expect(mockTaskQueue).toHaveBeenCalledWith(
      'locations/europe-west2/functions/onBatchStageDispatch',
    );
  });

  it('carries IDS ONLY in the task payload, scheduled at the planned start', async () => {
    await (onBatchWritten as unknown as Function)(event(deleted, snap(makeBatch())));

    expect(mockEnqueue).toHaveBeenNthCalledWith(
      1,
      { batchId: BATCH_ID, stageId: 'mix', plannedStartAt: at(60) },
      { scheduleTime: new Date(at(60)) },
    );
  });

  it('does NOT enqueue for an abandoned run', async () => {
    const batch = makeBatch({ state: 'abandoned' });

    await (onBatchWritten as unknown as Function)(event(deleted, snap(batch)));

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockTaskQueue).not.toHaveBeenCalled();
  });

  it('returns without enqueue when the batch was deleted', async () => {
    await (onBatchWritten as unknown as Function)(event(snap(makeBatch()), deleted));

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockTaskQueue).not.toHaveBeenCalled();
  });

  it('logs and returns on a batch doc that fails validation', async () => {
    await (onBatchWritten as unknown as Function)(event(deleted, snap({ id: 'junk' })));

    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('onBatchWritten — the diff', () => {
  it('does NOT re-enqueue reminders unchanged since the prior write', async () => {
    // A batch is written on every advance, every rationale edit, every updatedAt
    // bump. Without the diff each of those would re-queue every remaining reminder.
    const batch = makeBatch();

    await (onBatchWritten as unknown as Function)(
      event(snap(batch), snap({ ...batch, updatedAt: '2026-08-14T17:30:00.000Z' })),
    );

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('enqueues a RE-TIMED stage, because its planned start is a new key', async () => {
    // The cancellation-free design: nothing deletes the old task, it simply matches
    // nothing when it fires.
    const before = makeBatch();
    const after = makeBatch({
      stages: before.stages.map((s) => (s.id === 'bake' ? stage('bake', 'active', 800) : s)),
    });

    await (onBatchWritten as unknown as Function)(event(snap(before), snap(after)));

    expect(enqueuedStageIds()).toEqual(['bake']);
    expect(mockEnqueue).toHaveBeenCalledWith(
      { batchId: BATCH_ID, stageId: 'bake', plannedStartAt: at(800) },
      { scheduleTime: new Date(at(800)) },
    );
  });

  it('stays quiet about the stage a cook has just started', async () => {
    // Advancing a stage stamps the successor's actualStartAt at the same instant it
    // re-times it. Pinging someone to start what they are already standing over is
    // noise, so a stage that has begun (or finished) earns no reminder.
    const before = makeBatch();
    const after = makeBatch({
      stages: before.stages.map((s) => {
        if (s.id === 'bulk') return { ...s, actualEndAt: at(75) };
        if (s.id === 'shape') return stage('shape', 'active', 75, { actualStartAt: at(75) });
        return s;
      }),
    });

    await (onBatchWritten as unknown as Function)(event(snap(before), snap(after)));

    expect(enqueuedStageIds()).not.toContain('shape');
  });
});

describe('onBatchWritten — the clock guards', () => {
  it('skips a stage whose moment has already passed', async () => {
    // "I am mixing NOW" anchors the first stage at the instant the button was
    // tapped; Cloud Tasks would dispatch that immediately and ping someone about
    // what they are visibly doing. The valuable half of the first-stage rule — a
    // back-solved "mix at 13:20" hours ahead — is untouched, and covered above.
    const batch = makeBatch({
      stages: [
        stage('mix', 'active', -1),
        stage('bulk', 'wait', 20),
        stage('shape', 'active', 200),
      ],
    });

    await (onBatchWritten as unknown as Function)(event(deleted, snap(batch)));

    expect(enqueuedStageIds()).toEqual(['shape']);
  });

  it('does NOT enqueue a stage beyond the Cloud Tasks 30-day horizon', async () => {
    // Cloud Tasks refuses a scheduleTime more than 30 days ahead. Bread never gets
    // near it; a 90-day cure (phase 04) will, and this is the guard it must find
    // rather than the surprise it would otherwise meet.
    const batch = makeBatch({
      stages: [
        stage('rub', 'active', 60),
        stage('dry', 'wait', 80),
        // 90 days out — well past the horizon.
        stage('slice', 'active', 90 * 24 * 60),
      ],
    });

    await (onBatchWritten as unknown as Function)(event(deleted, snap(batch)));

    // The reachable reminder still goes; only the unreachable one is dropped.
    expect(enqueuedStageIds()).toEqual(['rub']);
  });

  it('enqueues a stage just INSIDE the horizon', async () => {
    const batch = makeBatch({
      stages: [
        stage('rub', 'active', 60),
        stage('dry', 'wait', 80),
        stage('slice', 'active', 29 * 24 * 60),
      ],
    });

    await (onBatchWritten as unknown as Function)(event(deleted, snap(batch)));

    expect(enqueuedStageIds()).toEqual(['rub', 'slice']);
  });
});

describe('onBatchWritten — failure handling', () => {
  it('reports a failed enqueue and still queues the rest', async () => {
    // One failure must not fail the trigger and re-fire it, which would re-enqueue
    // everything that DID succeed. The dispatch ledger de-dupes any eventual double.
    mockEnqueue.mockRejectedValueOnce(new Error('queue does not exist'));

    await expect(
      (onBatchWritten as unknown as Function)(event(deleted, snap(makeBatch()))),
    ).resolves.toBeUndefined();

    expect(mockEnqueue).toHaveBeenCalledTimes(4);
    expect(mockReport).toHaveBeenCalledTimes(1);
  });
});
