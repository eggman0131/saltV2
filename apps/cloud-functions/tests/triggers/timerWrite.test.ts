import { describe, it, expect, vi, beforeEach } from 'vitest';

// Characterisation net over BOTH timer-write enqueue triggers — cook (#544) and
// kitchen (#842) — ahead of the consolidation in #987. One table, run twice, once
// per timer kind.
//
// It replaces `onCookTimerWrite.test.ts` (11 of 11 assertions were
// `toHaveBeenCalled*`) and `onKitchenTimerWrite.test.ts` (18 of 20). Those suites
// asserted that `queue.enqueue` was called — an assertion about the shape of the
// exact code #987 consolidates, which would have stayed green through a broken
// consolidation. This one asserts the OBSERVABLE result instead: the exact set of
// task payloads and `scheduleTime` values a fake queue received, and the queue
// they were sent to (UT-A1/UT-A2, docs/unit-test-spec.md).
//
// Two traps this repo has already paid for, both actively excluded here:
//
//  • #928's invisible document. A "must not enqueue" row can pass because the
//    fixture never reached the code at all. So every row carries a DECOY — a timer
//    that must not appear in the enqueued set — and every decoy is proved by
//    MUTATION: a second run over the same fixture with the one axis under test
//    flipped, which must then enqueue the decoy. A row whose decoy was invisible
//    fails its mutation case.
//  • #931's batch atomicity. A recorder that logs an identical shape for one bulk
//    call and for N per-item calls pins nothing. The fake queue below records one
//    entry per `enqueue` INVOCATION with its raw argument list, and the rows assert
//    invocation-by-invocation plus that no payload is an array.
//
// Both schemas stay REAL (never mocked) — that is what makes the parse rows mean
// anything.

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The fake queue. One record per invocation, keeping the raw args, so "one task
// per timer" is distinguishable from "one bulk call carrying an array".
interface EnqueueRecord {
  readonly queue: string;
  readonly args: readonly unknown[];
}
const enqueued: EnqueueRecord[] = [];
// Lets a row make a specific enqueue reject without stubbing the recorder away —
// the attempt is still recorded, which is the whole point of the failure row.
let failEnqueue: (payload: unknown) => boolean = () => false;

vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({
    taskQueue: (queue: string) => ({
      enqueue: async (...args: unknown[]) => {
        enqueued.push({ queue, args });
        if (failEnqueue(args[0])) throw new Error('queue unavailable');
      },
    }),
  }),
}));

const mockReport = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);
vi.mock('@salt/observability/server', async (importOriginal) => ({
  // Spread the real module so an export the ENTRYPOINT WRAPPER needs
  // (runWithSuppliedTraceContext) cannot go missing from this mock. Only the two
  // calls this suite asserts on are overridden.
  ...((await importOriginal()) as Record<string, unknown>),
  flushServerObservability: mockFlush,
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: mockReport })),
}));

const { onCookTimerWrite } = await import('../../src/triggers/onCookTimerWrite.js');
const { onKitchenTimerWrite } = await import('../../src/triggers/onKitchenTimerWrite.js');

// ─── Fixtures, in terms both timer kinds share ────────────────────────────────

const T1 = '2026-08-16T18:10:00.000Z';
const T2 = '2026-08-16T18:35:00.000Z';
const T3 = '2026-08-16T19:00:00.000Z';

const SESSION_ID = 'recipe-1_uid-1';
const UID = 'uid-1';

// The three fields the two schemas genuinely share (see #987's Open Questions —
// they are NOT unified in the schema layer, deliberately). Everything else a kind
// needs is filled in by its own document builder below.
interface AbstractTimer {
  readonly id: string;
  readonly endsAt: string;
  readonly notify: boolean;
  readonly label: string;
  /**
   * Cook only, and only where a row needs `id` and `stepId` to DIFFER; the
   * kitchen document builder ignores it. Undefined means "let the builder mirror
   * `id`", which is what every shared row wants.
   */
  readonly stepId?: string | null;
}

const armed = (id: string, endsAt: string): AbstractTimer => ({
  id,
  endsAt,
  notify: true,
  label: id,
});
const silent = (id: string, endsAt: string): AbstractTimer => ({
  ...armed(id, endsAt),
  notify: false,
});
const renamed = (t: AbstractTimer, label: string): AbstractTimer => ({ ...t, label });
/** An ad-hoc cook timer: started from the timer bar, so it belongs to no step. */
const adHoc = (t: AbstractTimer): AbstractTimer => ({ ...t, stepId: null });
/** A cook timer started from a method step: a minted id, and the step's own id beside it. */
const forStep = (t: AbstractTimer, stepId: string): AbstractTimer => ({ ...t, stepId });

type DocState =
  | { readonly state: 'deleted' }
  | { readonly state: 'valid'; readonly timers: readonly AbstractTimer[] }
  // Present, but fails the schema. The kind builders drop ONE required field, so
  // the mutation "the same document parses" is the only difference between the
  // unparseable fixture and its valid twin.
  | { readonly state: 'invalid'; readonly timers: readonly AbstractTimer[] };

const DELETED: DocState = { state: 'deleted' };
const valid = (...timers: AbstractTimer[]): DocState => ({ state: 'valid', timers });
const invalid = (...timers: AbstractTimer[]): DocState => ({ state: 'invalid', timers });

interface Fixture {
  readonly before: DocState;
  readonly after: DocState;
}

interface TimerKind {
  readonly kind: 'cook' | 'kitchen';
  readonly trigger: (event: unknown) => Promise<void>;
  readonly queue: string;
  readonly params: Record<string, string>;
  document(timers: readonly AbstractTimer[], state: 'valid' | 'invalid'): unknown;
  payload(t: AbstractTimer): unknown;
}

const COOK: TimerKind = {
  kind: 'cook',
  trigger: onCookTimerWrite as unknown as (event: unknown) => Promise<void>,
  queue: 'locations/europe-west2/functions/onCookTimerDispatch',
  params: { sessionId: SESSION_ID },
  document(timers, state) {
    const doc: Record<string, unknown> = {
      id: SESSION_ID,
      schemaVersion: 1,
      ownerUid: UID,
      recipeId: 'recipe-1',
      recipeUpdatedAtAtStart: '2026-08-16T17:00:00.000Z',
      checkedIngredientIds: [],
      completedStepIds: [],
      activeTimers: timers.map((t) => ({
        id: t.id,
        stepId: t.stepId === undefined ? t.id : t.stepId,
        label: t.label,
        durationMinutes: 10,
        endsAt: t.endsAt,
        notify: t.notify,
      })),
      createdAt: '2026-08-16T17:00:00.000Z',
      updatedAt: T1,
    };
    // `schemaVersion` is a `z.literal(1)` — dropping it is the smallest edit that
    // makes an otherwise complete session unparseable.
    if (state === 'invalid') delete doc['schemaVersion'];
    return doc;
  },
  payload: (t) => ({ sessionId: SESSION_ID, timerId: t.id, endsAt: t.endsAt }),
};

const KITCHEN: TimerKind = {
  kind: 'kitchen',
  trigger: onKitchenTimerWrite as unknown as (event: unknown) => Promise<void>,
  queue: 'locations/europe-west2/functions/onKitchenTimerDispatch',
  params: { uid: UID },
  document(timers, state) {
    const doc: Record<string, unknown> = {
      ownerUid: UID,
      timers: timers.map((t) => ({
        id: t.id,
        label: t.label,
        endsAt: t.endsAt,
        durationMinutes: 10,
        notify: t.notify,
      })),
    };
    // `ownerUid` is required — the smallest edit that makes the document fail.
    if (state === 'invalid') delete doc['ownerUid'];
    return doc;
  },
  payload: (t) => ({ uid: UID, timerId: t.id, endsAt: t.endsAt }),
};

const KINDS = [COOK, KITCHEN];

function snapshot(kind: TimerKind, state: DocState): unknown {
  if (state.state === 'deleted') return { exists: false, data: () => undefined };
  const data = kind.document(state.timers, state.state);
  return { exists: true, data: () => data };
}

async function run(kind: TimerKind, fixture: Fixture): Promise<void> {
  await kind.trigger({
    data: { before: snapshot(kind, fixture.before), after: snapshot(kind, fixture.after) },
    params: kind.params,
  });
}

const payloads = (): unknown[] => enqueued.map((e) => e.args[0]);
const schedules = (): unknown[] => enqueued.map((e) => e.args[1]);

/** Assert the exact set of tasks the queue received, and that they arrived one call per timer. */
function expectEnqueued(kind: TimerKind, expected: readonly AbstractTimer[]): void {
  expect(payloads()).toEqual(expected.map((t) => kind.payload(t)));
  expect(schedules()).toEqual(expected.map((t) => ({ scheduleTime: new Date(t.endsAt) })));
  // Behavior Contract clause 3: region-qualified, or firebase-admin silently
  // resolves a us-central1 queue that does not exist.
  expect([...new Set(enqueued.map((e) => e.queue))]).toEqual(
    expected.length > 0 ? [kind.queue] : [],
  );
  // One INVOCATION per timer, each carrying a single payload object — never one
  // bulk call over an array (#931).
  expect(enqueued.map((e) => e.args.length)).toEqual(expected.map(() => 2));
  expect(enqueued.filter((e) => Array.isArray(e.args[0]))).toEqual([]);
}

// ─── The table ────────────────────────────────────────────────────────────────

interface Row {
  readonly name: string;
  readonly fixture: Fixture;
  readonly expected: readonly AbstractTimer[];
  /** The timer this row says must NOT be enqueued. */
  readonly decoy: AbstractTimer;
  /** What the mutation flips, named in the mutation case's title. */
  readonly mutation: string;
  /** The same fixture with that one axis flipped — the decoy must then be enqueued. */
  readonly mutated: Fixture;
}

const ROWS: Row[] = [
  {
    name: 'a create arming one timer enqueues exactly that timer',
    fixture: { before: DELETED, after: valid(armed('t1', T1), silent('decoy', T2)) },
    expected: [armed('t1', T1)],
    decoy: silent('decoy', T2),
    mutation: 'the decoy is armed',
    mutated: { before: DELETED, after: valid(armed('t1', T1), armed('decoy', T2)) },
  },
  {
    name: 'an unchanged rewrite (a mise tick rewrites the whole doc) enqueues nothing',
    fixture: { before: valid(armed('t1', T1)), after: valid(armed('t1', T1)) },
    expected: [],
    decoy: armed('t1', T1),
    mutation: 'the prior write no longer holds it',
    mutated: { before: valid(), after: valid(armed('t1', T1)) },
  },
  {
    name: 'dismissing a different timer does not re-arm the survivor',
    fixture: { before: valid(armed('t1', T1), armed('t2', T2)), after: valid(armed('t1', T1)) },
    expected: [],
    decoy: armed('t1', T1),
    mutation: 'the prior write no longer holds it',
    mutated: { before: valid(armed('t2', T2)), after: valid(armed('t1', T1)) },
  },
  {
    name: 're-timing a timer enqueues a fresh task under the new key',
    fixture: {
      before: valid(armed('t1', T1), armed('t2', T3)),
      after: valid(armed('t1', T2), armed('t2', T3)),
    },
    expected: [armed('t1', T2)],
    decoy: armed('t2', T3),
    mutation: 'the prior write no longer holds the untouched timer',
    mutated: { before: valid(armed('t1', T1)), after: valid(armed('t1', T2), armed('t2', T3)) },
  },
  {
    name: 'renaming a timer without re-timing it enqueues nothing',
    fixture: { before: valid(armed('t1', T1)), after: valid(renamed(armed('t1', T1), 'renamed')) },
    expected: [],
    decoy: armed('t1', T1),
    mutation: 'the prior write no longer holds it',
    mutated: { before: valid(), after: valid(renamed(armed('t1', T1), 'renamed')) },
  },
  {
    name: 'a notify:false timer never enqueues, and the queue is never taken',
    fixture: { before: DELETED, after: valid(silent('decoy', T1)) },
    expected: [],
    decoy: silent('decoy', T1),
    mutation: 'the decoy is armed',
    mutated: { before: DELETED, after: valid(armed('decoy', T1)) },
  },
  {
    name: 'a deleted document enqueues nothing',
    fixture: { before: valid(armed('t1', T1)), after: DELETED },
    expected: [],
    decoy: armed('t1', T1),
    mutation: 'the document still exists',
    mutated: { before: DELETED, after: valid(armed('t1', T1)) },
  },
  {
    name: 'an unparseable after enqueues nothing',
    fixture: { before: DELETED, after: invalid(armed('t1', T1), silent('decoy', T2)) },
    expected: [],
    decoy: armed('t1', T1),
    mutation: 'the same document parses',
    mutated: { before: DELETED, after: valid(armed('t1', T1), silent('decoy', T2)) },
  },
  {
    name: 'an unparseable before treats every armed timer as new',
    fixture: {
      before: invalid(armed('t1', T1)),
      after: valid(armed('t1', T1), silent('decoy', T2)),
    },
    expected: [armed('t1', T1)],
    decoy: silent('decoy', T2),
    mutation: 'the decoy is armed',
    mutated: {
      before: invalid(armed('t1', T1)),
      after: valid(armed('t1', T1), armed('decoy', T2)),
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  enqueued.length = 0;
  failEnqueue = () => false;
});

describe.each(KINDS)('$kind timer write trigger', (kind) => {
  it.each(ROWS)('$name', async (row) => {
    await run(kind, row.fixture);

    expectEnqueued(kind, row.expected);
    expect(payloads()).not.toContainEqual(kind.payload(row.decoy));
  });

  // The #928 guard. Without these, a "must not enqueue" row above could be green
  // because the code never saw the fixture at all.
  it.each(ROWS)('$name — decoy proved by mutation: $mutation', async (row) => {
    await run(kind, row.mutated);

    expect(payloads()).toContainEqual(kind.payload(row.decoy));
  });

  // Behavior Contract clause 6. A rejected enqueue must not reject the trigger —
  // that would re-fire it and duplicate the enqueues that DID succeed.
  it('reports a failed enqueue, still enqueues the rest, and never rejects', async () => {
    failEnqueue = (p) => (p as { timerId: string }).timerId === 't1';
    const fixture: Fixture = {
      before: DELETED,
      after: valid(armed('t1', T1), armed('t2', T2), silent('decoy', T3)),
    };

    await expect(run(kind, fixture)).resolves.toBeUndefined();

    expectEnqueued(kind, [armed('t1', T1), armed('t2', T2)]);
    expect(payloads()).not.toContainEqual(kind.payload(silent('decoy', T3)));
    expect(mockReport).toHaveBeenCalledTimes(1);
  });

  it('flushes server observability even on a write that enqueues nothing', async () => {
    await run(kind, { before: DELETED, after: valid(silent('decoy', T1)) });

    expectEnqueued(kind, []);
    expect(mockFlush).toHaveBeenCalled();
  });
});

// Cook only: every row in the shared table builds `stepId: t.id`, so not one of
// them can tell the two fields apart — and in production they are never the same
// value. `CookActiveTimerSchema`'s header is explicit that they are not
// interchangeable: "`id` — NOT `stepId` — is its identity everywhere: … the
// enqueue trigger's diff key, the Cloud Task payload, the timerDeliveries ledger
// id". A timer started from a method step carries a minted id AND the step's id;
// one started from the timer bar carries a minted id and a NULL `stepId`. Build
// the payload from `stepId` and the whole shared table stays green while
// `onCookTimerDispatch`'s re-read (`activeTimers.find((t) => t.id === timerId &&
// …)`) never matches, so the push is silently missed with no error anywhere. Both
// shapes are in this row deliberately — the null one is the case a `stepId ?? id`
// slip recovers from, and the string one is the case it does not. This is what
// `onCookTimerWrite.test.ts` covered and the shared net did not.
const AD_HOC_ROWS: Row[] = [
  {
    name: 'a step timer and an ad-hoc timer each enqueue under their own id, not their stepId',
    fixture: {
      before: DELETED,
      after: valid(
        forStep(armed('timer-a', T1), 'step-3'),
        adHoc(armed('timer-b', T2)),
        adHoc(silent('timer-decoy', T3)),
      ),
    },
    expected: [forStep(armed('timer-a', T1), 'step-3'), adHoc(armed('timer-b', T2))],
    decoy: adHoc(silent('timer-decoy', T3)),
    mutation: 'the decoy is armed',
    mutated: {
      before: DELETED,
      after: valid(
        forStep(armed('timer-a', T1), 'step-3'),
        adHoc(armed('timer-b', T2)),
        adHoc(armed('timer-decoy', T3)),
      ),
    },
  },
];

describe('onCookTimerWrite — a timer whose id is not its stepId', () => {
  it.each(AD_HOC_ROWS)('$name', async (row) => {
    await run(COOK, row.fixture);

    expectEnqueued(COOK, row.expected);
    expect(payloads()).not.toContainEqual(COOK.payload(row.decoy));
  });

  it.each(AD_HOC_ROWS)('$name — decoy proved by mutation: $mutation', async (row) => {
    await run(COOK, row.mutated);

    expect(payloads()).toContainEqual(COOK.payload(row.decoy));
  });
});

// Cook only: `CookActiveTimerSchema`'s `z.preprocess` backfills `id` from `stepId`
// for sessions written before #748. cookSessions have no TTL and a cook can span
// days, so such an entry can still be live. The kitchen schema has no preprocess
// and deliberately never gains one (#987 Open Questions).
describe('onCookTimerWrite — legacy timer entries', () => {
  it('enqueues a pre-#748 entry under the id backfilled from its stepId', async () => {
    const legacy = { stepId: 'step-1', endsAt: T1, notify: true };
    const doc = COOK.document([], 'valid') as Record<string, unknown>;

    await COOK.trigger({
      data: {
        before: { exists: false, data: () => undefined },
        after: { exists: true, data: () => ({ ...doc, activeTimers: [legacy] }) },
      },
      params: COOK.params,
    });

    expect(payloads()).toEqual([{ sessionId: SESSION_ID, timerId: 'step-1', endsAt: T1 }]);
    expect(schedules()).toEqual([{ scheduleTime: new Date(T1) }]);
  });
});
