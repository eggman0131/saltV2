import type { Change, DocumentSnapshot, FirestoreEvent } from 'firebase-functions/v2/firestore';
import type { Request as TaskRequest } from 'firebase-functions/v2/tasks';
import { flushServerObservability } from '@salt/observability/server';
import { whenCfTelemetryReady } from '../observability/telemetryReady.js';
import { runTriggerWithTraceContext } from './triggerTraceContext.js';

// ─── The trigger entrypoint (issue #920) ──────────────────────────────────────
//
// EVERY Firestore and Cloud Tasks trigger runs its body through this wrapper. It
// owns the three obligations a trigger cannot be correct without, in the order
// they have to happen:
//
//   await telemetry readiness → run inside the doc's trace context → finally FLUSH
//
// All three were conventions applied by hand, and the hand had slipped in exactly
// the way a convention does: at the time #920 was filed `flushServerObservability`
// was present in 12 of 16 files here, `whenCfTelemetryReady` in 3, and
// `runTriggerWithTraceContext` in 2. The review filed the readiness gap as "three
// triggers omit it"; the count was the other way round — three HAD it.
//
// Order matters and is the reason this is one wrapper rather than three helpers:
//
//  • Readiness FIRST. `enableFirebaseTelemetry()` boots the OTel pipeline
//    asynchronously and nothing awaits it, so a cold-started trigger that extracts
//    a trace context before the propagator exists silently drops it and re-roots.
//    Awaiting readiness before entering the context is what makes the context work
//    (see observability/telemetryReady.ts).
//  • Trace context SECOND, around the body, so the trigger's spans nest under the
//    browser-rooted trace carried by the written document rather than starting a
//    fresh one.
//  • Flush LAST, in a `finally`, because posthog-node batches and an un-flushed
//    event is lost when the instance freezes.
//
// A trigger registered without this wrapper fails tests/triggers/entrypointFactory.test.ts.
// A Firestore document-written event with the default params record. Deliberately
// NOT generic over the document path: a handler that accepts the wider
// `Record<string, string>` is assignable where a path-specific params type is
// expected (parameter contravariance), and keeping it concrete is what lets the
// inline `async (event) => …` at each call site be contextually typed. A generic
// TEvent cannot do that — an unannotated arrow gives inference nothing to work
// from, so TEvent lands on `unknown` and every `event.params` access breaks.
type FirestoreWrittenEvent<Params extends Record<string, string> = Record<string, string>> =
  FirestoreEvent<Change<DocumentSnapshot> | undefined, Params>;

// The shared body. Both façades below are this function; they differ only in the
// event type they publish, which is what makes the call sites typecheck.
function runTriggerBody<TEvent>(
  event: TEvent,
  handler: (event: TEvent) => unknown,
  traceContextOf?: (event: unknown) => string | undefined,
): Promise<void> {
  return (async () => {
    // Cold start: let the OTel pipeline come up (bounded) before extracting, or
    // the supplied trace is dropped and the work re-roots. Never rejects.
    await whenCfTelemetryReady();
    try {
      await runTriggerWithTraceContext(traceContextOf?.(event), () => handler(event));
    } finally {
      // posthog-node batches; drain before the instance freezes. Idempotent and
      // non-throwing, so it is safe on the happy path too.
      await flushServerObservability();
    }
  })();
}

// Firestore document triggers.
export function withFirestoreTrigger<
  // The path params this trigger reads, e.g. `{ id: string }` for
  // `recipes/{id}`. Name it at the call site when the handler uses
  // `event.params`: the repo compiles with `noUncheckedIndexedAccess`, so the
  // default index signature yields `string | undefined` and a precise type is
  // what makes `event.params.id` a plain `string` — the same type onDocumentWritten
  // derives from the document path.
  Params extends Record<string, string> = Record<string, string>,
>(
  handler: (event: FirestoreWrittenEvent<Params>) => unknown,
  // How to find the W3C `traceparent` this event continues, if the collection
  // carries one. Firestore triggers have no inbound HTTP header, so the context
  // rides on the written doc as an optional additive `traceContext` field
  // (issue #362 Phase 5). Omit for collections that carry none — the body then
  // runs in a plain root trace, which is the documented degrade (Rule 10).
  traceContextOf?: (event: unknown) => string | undefined,
): (event: FirestoreWrittenEvent<Params>) => Promise<void> {
  return (event) => runTriggerBody(event, handler, traceContextOf);
}

// Cloud Tasks dispatch triggers. A task carries its payload, not a document, so
// there is no `traceContext` field to continue — these run in a plain root trace.
export function withTaskTrigger<TPayload>(
  handler: (request: TaskRequest<TPayload>) => unknown,
): (request: TaskRequest<TPayload>) => Promise<void> {
  return (request) => runTriggerBody(request, handler);
}

// The `traceContext` reader for a Firestore document-written event.
//
// Takes `unknown` deliberately. Typed narrowly, TypeScript unifies `TEvent` from
// BOTH parameters of withTriggerEntrypoint, and this reader's shape — not the
// handler's real Firestore event — wins, so the handler then loses `event.params`,
// `data.before` and the rest. Accepting `unknown` here lets TEvent infer purely
// from the handler, which is the type that matters.
//
// Defensive by design: the field is OPTIONAL and additive, so old documents (and
// every collection that never adopted it) simply have none, and a missing or
// malformed value degrades to a normal root trace rather than failing the trigger.
export function traceContextFromWrittenDoc(event: unknown): string | undefined {
  const after = (
    event as { data?: { after?: { data?: () => Record<string, unknown> | undefined } } } | undefined
  )?.data?.after;
  const value = after?.data?.()?.['traceContext'];
  return typeof value === 'string' ? value : undefined;
}
