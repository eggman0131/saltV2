import {
  onCall,
  HttpsError,
  type CallableOptions,
  type CallableRequest,
} from 'firebase-functions/https';
import {
  whenServerObservabilityReady,
  runWithExtractedTraceContext,
  runWithSuppliedTraceContext,
  flushServerObservability,
} from '@salt/observability/server';
import { reportFlowError } from './observability/reportServerError.js';

// ─── The traced-callable factory (issue #415) ────────────────────────────────
//
// Every user-initiated AI/match callable shares ONE entrypoint sequence:
//
//   auth check → wire safeParse → strip `traceparent` → whenServerObservabilityReady
//     → runFlowWithTraceContext → catch (report/map) → finally flush
//
// It was copy-pasted 7× in index.ts, and the duplication had already produced a
// divergence bug: two of the seven never flushed their spans on the happy path.
// makeTracedCallable owns the whole sequence — including the `finally` flush — so
// the flush gap is impossible to reintroduce and every callable is uniform. The
// per-callable variation (wire schema, flow, secrets, timeout, and the one
// callable that maps a bespoke error taxonomy) rides in as declarative options.

// App Check enforcement for every callable. Monitor-first (#145): unverified
// requests are still allowed but reported to App Check metrics. Flip this single
// line to `true` once staging metrics confirm legitimate traffic verifies — that
// is the enforcement step of the rollout (callables first, the AI cost surface).
// Owned here so the factory applies it uniformly; index.ts imports it for the
// onCallGenkit / non-traced onCall callables so they stay consistent too.
export const APP_CHECK_ENFORCEMENT = { enforceAppCheck: false } as const;

// A validated wire envelope: the pure domain input plus the optional browser-
// supplied `traceparent`. Structurally matches a Zod schema's `safeParse` so the
// factory needs no direct zod dependency.
interface WireSchema<TWire extends { traceparent?: string | undefined }> {
  safeParse(data: unknown): { success: true; data: TWire } | { success: false; error: unknown };
}

// The catch handler: report/map a flow failure, then throw. Always throws, so it
// returns `Promise<never>`. The default reports the genuine cause (uncategorised
// → gates as reportable, "report the unexpected") and re-throws unchanged;
// callables with an expected-outcome taxonomy (e.g. extractRecipeFromUrl) supply
// their own to suppress the expected codes and map to user-facing HttpsErrors.
export type CallableErrorHandler = (err: unknown) => Promise<never>;

const defaultOnError: CallableErrorHandler = async (err) => {
  // AI/Genkit flow failure (incl. AiTimeoutError). Report the genuine cause
  // additively, flush, then re-throw so the callable's error path is unchanged.
  await reportFlowError(err);
  throw err;
};

// ─── Browser→CF trace continuity (issue #362, Phase 3) ────────────────────────
//
// Run the flow within a W3C trace context so its span nests under one coherent
// invocation trace instead of re-rooting. These are USER-INITIATED callables, so
// the browser-supplied field is the PREFERRED channel. There are TWO sources,
// applied with this precedence:
//   1. A browser-SUPPLIED `traceparent` carried as a NAMED, TYPED, OPTIONAL field
//      on the callable WIRE input. The Firebase JS callable SDK cannot carry a
//      custom `traceparent` HTTP header (HttpsCallableOptions is only
//      { timeout?, limitedUseAppCheckTokens? } and the transport sets its own
//      fixed headers), so a browser-minted trace id can ONLY ride as this field.
//      It is schema-validated and stripped by the caller before the flow runs —
//      NOT the forbidden magic `_trace`. Preferred — it is the only channel that
//      can unify the browser action with the server flow.
//   2. Else the inbound W3C trace HEADER on the underlying request
//      (request.rawRequest.headers). This is GCP's FRESH request-trace root, so
//      it can never carry the browser's trace id — it is the fallback only when
//      no non-empty supplied field is present.
//
// Env-gated on GENKIT_TELEMETRY_SERVER (set only by `pnpm dev:emulators`):
//   • Local dev (set): SUPPRESS propagation — run the flow without installing any
//     parent context, so it stays root-listed in the Genkit Dev UI (whose trace
//     list only surfaces flow-rooted traces). This gate resolves the 2026-05-11
//     regression that previously parked propagation.
//   • Production (unset): honour the trace context per the precedence above via
//     runWithSuppliedTraceContext / runWithExtractedTraceContext (both degrade to
//     a plain call when no context is present, and never throw — Rule 10).
//
// A malformed/absent traceparent must NOT fail the call: it is optional and
// best-effort, so we just skip propagation. Only a malformed WIRE ENVELOPE (bad
// domain input) is rejected — with HttpsError('invalid-argument') at the caller.
function runFlowWithTraceContext<T>(
  domainInput: unknown,
  headers: import('node:http').IncomingHttpHeaders | undefined,
  traceparent: string | undefined,
  flow: (input: never) => T,
): T {
  // Local dev: suppress propagation so flows stay root-listed in the Dev UI.
  if (process.env['GENKIT_TELEMETRY_SERVER']) {
    return flow(domainInput as never);
  }
  // Production. The browser-supplied `traceparent` field WINS: it is the only
  // channel that can carry the browser's trace id (the Firebase callable SDK
  // can't carry a custom HTTP header), so it is the one that actually unifies the
  // browser action with the server flow. The inbound W3C header is GCP's FRESH
  // request-trace root — preferring it would re-root away from the browser trace
  // and could never unify with it — so it is the fallback only when no non-empty
  // field is present. Both helpers degrade safely to a plain call (Rule 10).
  if (traceparent) {
    return runWithSuppliedTraceContext(traceparent, () => flow(domainInput as never));
  }
  return runWithExtractedTraceContext(headers ?? {}, () => flow(domainInput as never));
}

interface TracedCallableConfig<TWire extends { traceparent?: string | undefined }> {
  // The WIRE-envelope schema (<Name>WireInputSchema): domain input + optional
  // traceparent. Validated at the entrypoint; traceparent is stripped so the flow
  // receives the PURE domain input (domain purity).
  wireSchema: WireSchema<TWire>;
  // The domain flow (an ai.defineFlow result, or any (input) => result). Receives
  // the pure domain input; never sees traceparent.
  flow: (input: never) => unknown;
  // onCall options that vary per callable (secrets, timeoutSeconds, …). App Check
  // enforcement is applied by the factory and need not be passed.
  options: CallableOptions;
  // User-facing message for a rejected wire envelope. Defaults to the generic
  // "Invalid request payload." — override where the client copy should differ
  // (e.g. a URL-import callable's "That doesn't look like a valid web address.").
  invalidArgumentMessage?: string;
  // Catch handler for a flow failure. Defaults to report-the-cause-and-rethrow;
  // override to map a bespoke error taxonomy to user-facing HttpsErrors.
  onError?: CallableErrorHandler;
}

// Manual onCall (instead of onCallGenkit) so the trace context is installed as the
// active OTel context BEFORE Genkit opens the flow span — so the flow span nests
// under the request trace and each invocation renders as ONE coherent trace,
// instead of the flow re-rooting a fresh trace. See runFlowWithTraceContext above
// for the field→header precedence and env-gating.
export function makeTracedCallable<TWire extends { traceparent?: string | undefined }>(
  config: TracedCallableConfig<TWire>,
) {
  const {
    wireSchema,
    flow,
    options,
    invalidArgumentMessage = 'Invalid request payload.',
    onError = defaultOnError,
  } = config;

  return onCall({ ...APP_CHECK_ENFORCEMENT, ...options }, async (request: CallableRequest) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    // Validate the WIRE envelope (domain input + optional traceparent). A bad
    // wire envelope is rejected; an absent/malformed traceparent is NOT a
    // failure (it is optional/best-effort). Strip traceparent so the flow
    // receives the PURE domain input (domain purity).
    const parsed = wireSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', invalidArgumentMessage);
    }
    const { traceparent, ...domainInput } = parsed.data;

    await whenServerObservabilityReady();

    try {
      return await runFlowWithTraceContext(
        domainInput,
        request.rawRequest?.headers,
        traceparent,
        flow,
      );
    } catch (err) {
      // onError always throws (reports/maps the cause, then throws).
      return await onError(err);
    } finally {
      // onCall has NO framework auto-flush (unlike onCallGenkit): drain any
      // in-flight span exports before the function freezes. Idempotent +
      // non-throwing, so flushing on the happy path too is safe — and it is the
      // uniform flush point that closes the per-callable happy-path flush gap
      // (#415). The error path's report() also flushes; flush is idempotent.
      await flushServerObservability();
    }
  });
}
