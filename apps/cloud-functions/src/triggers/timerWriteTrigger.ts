import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { reportServerError } from '../observability/reportServerError.js';
import { withFirestoreTrigger, traceContextFromWrittenDoc } from './triggerEntrypoint.js';

// The enqueue half of every timer-push pipeline, once (issue #987).
//
// A timer kind arms its pushes by writing a document holding an array of timers.
// On every write, the trigger diffs the armed (`notify: true`) timers against the
// prior write and enqueues ONE Cloud Task per NEWLY-armed timer, scheduled for its
// `endsAt`; the kind's dispatch handler sends the push when the task fires.
//
// Cook (#544) and kitchen (#842) were that logic written out twice, differing on
// five mechanical axes and nothing else — document, schema, timer array field,
// path parameter, and the dispatch function the queue is named for. A field added
// to one silently missed the other and nothing would have failed. They are now
// DECLARATIONS over this factory, and a third timer kind is a descriptor rather
// than a file.
//
// What this does NOT absorb is the dispatch side. `onCookTimerDispatch` re-reads
// `cookSessions` and enriches from the recipe, where `onKitchenTimerDispatch`
// re-reads a one-document-per-user array; that half genuinely forks and stays
// forked. The write side needs no document union — only these five values.
//
// Registration stays at each call site, deliberately: `memory` and `region` must
// be pinned in a literal options object at the `onDocumentWritten` call, because
// these modules are evaluated before index.ts's `setGlobalOptions` runs and a pin
// hoisted in here would not apply. `tests/functionMemoryPin.test.ts` scans for
// exactly that.

/** All this file needs of a timer: its identity, and whether it earns a push. */
export interface ArmableTimer {
  readonly id: string;
  readonly endsAt: string;
  readonly notify: boolean;
}

/**
 * Structural stand-in for the kind's zod schema. Deliberately structural rather
 * than `z.ZodType`: `cloud-functions` does not depend on `zod` directly (the
 * schemas arrive through `@salt/domain/schemas`), and adding a dependency to name
 * a type would be an issue-first layer change for nothing.
 */
export interface TimerDocumentSchema<TDoc> {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: TDoc }
    | { readonly success: false; readonly error: { readonly message: string } };
}

// A timer's identity for diffing: same timer + same absolute end-time. Extending
// (or shortening) a timer changes `endsAt` → a NEW key → a NEW task; the old task
// no-ops on dispatch because the re-read finds no timer at that end-time. That is
// why an adjusted duration needs no cancellation path, and why dismissing a timer
// is just its removal from the array.
//
// NOTE what this does NOT key on: the label. A timer renamed but not re-timed
// keeps its key and enqueues nothing new — correct, because the task carries ids
// only and the handler reads the name live at send time.
export function timerKey(t: ArmableTimer): string {
  return `${t.id}@${t.endsAt}`;
}

/** The five axes a timer kind differs on, plus the name its logs are grepped by. */
export interface TimerWriteDescriptor<
  TParams extends Record<string, string>,
  TDoc,
  TTimer extends ArmableTimer,
  TPayload,
> {
  /** The deployed function name, used as the log prefix. */
  readonly name: string;
  /** Parses the written document. Kept whole so back-compat preprocessing runs. */
  readonly schema: TimerDocumentSchema<TDoc>;
  /** Where the timers live on the parsed document. */
  readonly timersOf: (doc: TDoc) => readonly TTimer[];
  /** The document path parameter — `sessionId`, `uid` — and the log field name. */
  readonly paramName: keyof TParams & string;
  /** The region BOTH of the kind's functions are pinned to. */
  readonly region: string;
  /** The DEPLOYED name of the kind's dispatch handler. */
  readonly queueFunctionName: string;
  /** The ids-only task payload. Never labels or other free text. */
  readonly payloadOf: (paramValue: TParams[keyof TParams & string], timer: TTimer) => TPayload;
}

export function timerWriteTrigger<
  TParams extends Record<string, string>,
  TDoc,
  TTimer extends ArmableTimer,
  TPayload,
>(descriptor: TimerWriteDescriptor<TParams, TDoc, TTimer, TPayload>) {
  const { name, schema, timersOf, paramName, region, queueFunctionName, payloadOf } = descriptor;

  return withFirestoreTrigger<TParams>(async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    const paramValue = event.params[paramName];

    // Document deleted (the cook ended, the last timer went) — nothing to
    // enqueue. Any tasks already queued for its timers no-op on dispatch.
    if (!after?.exists) return;

    const parsed = schema.safeParse(after.data());
    if (!parsed.success) {
      logger.error(`${name}: invalid document, skipping`, {
        [paramName]: paramValue,
        error: parsed.error.message,
      });
      return;
    }

    // Prior timer keys, so a re-write that leaves a given timer untouched — a
    // mise-en-place tick, dismissing a DIFFERENT timer — does not re-enqueue it.
    // Absent/invalid before → empty set (a create, or a first-ever valid parse),
    // so every currently-armed timer counts as new. A duplicate task is deduped
    // by the dispatch ledger; a missed one is a timer that never rings.
    const priorKeys = new Set<string>();
    if (before?.exists) {
      const beforeParsed = schema.safeParse(before.data());
      if (beforeParsed.success) {
        for (const t of timersOf(beforeParsed.data)) priorKeys.add(timerKey(t));
      }
    }

    // Only NEWLY-armed notify timers get a task. A timer present in `before` with
    // the same key is already queued; a `notify: false` timer — one shorter than
    // the delivery-precision floor — never notifies.
    const newTimers = timersOf(parsed.data).filter(
      (t) => t.notify === true && !priorKeys.has(timerKey(t)),
    );
    if (newTimers.length === 0) return;

    // The task queue is keyed by the DEPLOYED dispatch function name, and it MUST
    // be region-qualified. firebase-admin's `taskQueue()` parses a bare name as
    // `{ resourceId }` with NO location and then falls back to its DEFAULT_LOCATION
    // of `us-central1` — it does NOT inherit the calling function's region. Since
    // every timer function is pinned to europe-west2, the bare form built a
    // us-central1 queue URL and every enqueue failed with `functions/not-found:
    // Queue does not exist`, silently killing all cook-timer pushes in every
    // environment. The `locations/{region}/functions/{name}` form is what
    // firebase-admin's parseResourceName accepts.
    const queue = getFunctions().taskQueue<TPayload>(
      `locations/${region}/functions/${queueFunctionName}`,
    );

    for (const t of newTimers) {
      try {
        await queue.enqueue(payloadOf(paramValue, t), { scheduleTime: new Date(t.endsAt) });
      } catch (err) {
        // One failed enqueue must not fail the whole trigger (and re-fire it,
        // re-enqueuing the timers that DID succeed → duplicates). Report and
        // move on; the dispatch ledger de-dupes any eventual double anyway.
        logger.error(`${name}: enqueue failed`, {
          [paramName]: paramValue,
          timerId: t.id,
          endsAt: t.endsAt,
          err,
        });
        reportServerError(err);
      }
    }
  }, traceContextFromWrittenDoc);
}
