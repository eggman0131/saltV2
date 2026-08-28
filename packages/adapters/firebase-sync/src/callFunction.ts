import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import { classifyCallableError, type CallableErrorOverrides } from './callableErrors.js';
import { FUNCTIONS_REGION } from './functionsRegion.js';

// The callable, once (issue #928, findings B2-010, B2-014 and B2-015).
//
// Thirty wrappers across seventeen modules were one ten-line body copied: build
// a callable in `europe-west2`, assemble a payload that may carry a
// `traceparent`, await it, wrap the answer, and map the rejection through
// `classifyCallableError`. Copying it thirty times is what let three things
// drift with nobody noticing — eight sites returned the raw `{kind:'ok', …}`
// literal rather than `success()` (none of their six files even imported it),
// nine hand-wrote the same `traceparent` ternary under six copies of the same
// explanatory paragraph, and ten passed no client timeout to a function allowed
// to run longer than the client's own 70 s default.
//
// The fix is structural rather than a sweep: those are symptoms, and the cause
// is that there was no one place to put any of them. A find-and-replace leaves
// the eighteenth wrapper free to reintroduce all three.
//
// DELIBERATELY NOT EXPORTED FROM index.ts — for the reason given in
// subscribeCollection.ts. The package's public surface is the `call*` wrappers,
// and a consumer has no business knowing the region, the transport, or how a
// trace id rides.

/**
 * `traceparent` on the wire (issues #361/#362), in the one place it is decided.
 *
 * The Firebase callable SDK cannot carry a custom `traceparent` HTTP header, so
 * a browser-supplied W3C trace id rides as a NAMED FIELD on the payload and the
 * CF entrypoint strips it before the flow runs. `firebase-sync` only ever
 * forwards the string it was handed — it never imports observability and never
 * mints a trace id (CLAUDE.md Rule 4).
 *
 * The ternary is the point and is not stylistic. An absent trace id must leave
 * the field OFF the payload rather than send it as `undefined`: the two are not
 * the same thing over the callable protocol, and every one of these wire schemas
 * declares the field optional rather than nullable. `tests/callableContract
 * .test.ts` asserts payloads with `toStrictEqual` for exactly this reason —
 * `toEqual` cannot tell the two apart.
 */
function withTraceparent<TInput extends object>(
  input: TInput,
  traceparent?: string,
): TInput | (TInput & { traceparent: string }) {
  return traceparent ? { ...input, traceparent } : input;
}

/**
 * A callable, built for this project's one region.
 *
 * The ONLY `getFunctions`/`httpsCallable` call site in the package — which is
 * what Phase 6's lint rule then makes structural rather than conventional.
 *
 * The option object is omitted entirely when there is no timeout rather than
 * passed as `{ timeout: undefined }`, so a wrapper that declares none gets the
 * SDK's own default by the SDK's own path.
 *
 * Exported for `streamChefChat` alone, which needs `fn.stream` and its explicit
 * drain loop. Wrapping that loop in a helper would hide the one thing about it
 * worth reading — that chunks reach the caller as they arrive — so it keeps the
 * loop and takes only the transport from here.
 */
export function callableRef<TInput, TWire, TChunk = never>(
  name: string,
  timeoutMs?: number,
): ReturnType<typeof httpsCallable<TInput, TWire, TChunk>> {
  const functions = getFunctions(undefined, FUNCTIONS_REGION);
  return timeoutMs === undefined
    ? httpsCallable<TInput, TWire, TChunk>(functions, name)
    : httpsCallable<TInput, TWire, TChunk>(functions, name, { timeout: timeoutMs });
}

/** What every call needs: which function, what to send, and how long to wait. */
export interface CallableCall<TInput extends object> {
  /** The deployed callable's name. */
  readonly name: string;
  /** The domain payload, before `traceparent` is (or is not) attached. */
  readonly input: TInput;
  /**
   * A browser-minted W3C trace id to forward, or nothing.
   *
   * `| undefined` is explicit because this repo compiles with
   * `exactOptionalPropertyTypes`: every caller forwards its own optional
   * parameter straight through, so the property genuinely arrives as
   * `string | undefined` rather than being omitted, and an absent one must be a
   * legal VALUE here rather than only a legal absence. `withTraceparent` is what
   * turns it back into an absent field on the wire.
   */
  readonly traceparent?: string | undefined;
  /**
   * How long the CLIENT waits, in milliseconds.
   *
   * Omitted means the Firebase callable client's own 70 s default. Declare one
   * whenever the Cloud Function's `timeoutSeconds` exceeds that, or the browser
   * gives up while the function is still running — and still WRITING — turning
   * work that succeeded into a visible error. Prefer the shared domain constant
   * where the function and the client are already paired by one
   * (`PHOTO_IMPORT_TIMEOUT_SECONDS`, `PROPOSE_SCHEDULE_CLIENT_TIMEOUT_MS`).
   */
  readonly timeoutMs?: number | undefined;
}

/**
 * Call a function and hand back its wire result, or THROW whatever the SDK
 * rejected with.
 *
 * The transport half alone: region, payload, timeout. For the five wrappers
 * whose failures are not `classifyCallableError`'s to map — the two recipe
 * imports with their own closed vocabularies, the two with a `functions/
 * not-found` arm ahead of the shared mapper, and `callMatchOrCreate`, which
 * returns the server's own `Result` envelope verbatim — and for the two
 * email-OTP wrappers, whose whole contract is that the raw error reaches
 * `auth.ts` unmapped (Rule 10's stated exception).
 *
 * Everything else wants `callFunction` below, which never throws.
 */
export async function invokeCallable<TInput extends object, TWire>(
  call: CallableCall<TInput>,
): Promise<TWire> {
  const fn = callableRef<TInput | (TInput & { traceparent: string }), TWire>(
    call.name,
    call.timeoutMs,
  );
  const res = await fn(withTraceparent(call.input, call.traceparent));
  return res.data;
}

/**
 * Call a function and answer with a `ReadResult`. NEVER throws (Rule 10).
 *
 * The shape twenty-two of the thirty wrappers now are. `project` is what the
 * caller wants out of the wire result — omitted for the majority who want it
 * whole, `() => undefined` for a callable whose answer is only that it worked,
 * and a real projection for the few who unwrap it (`callDescribeEquipmentSubject`
 * takes the brief out of the envelope Genkit's structured output requires).
 *
 * `overrides` is `classifyCallableError`'s per-call-site mechanism, passed
 * straight through rather than re-implemented: a callable that gives one gRPC
 * code a bespoke meaning declares it and inherits the rest of the mapping,
 * including the `navigator.onLine`-first ordering that keeps an offline failure
 * from being reported as a server fault.
 */
export async function callFunction<TInput extends object, TWire, TValue = TWire>(
  call: CallableCall<TInput> & {
    readonly project?: (wire: TWire) => TValue;
    readonly overrides?: CallableErrorOverrides;
  },
): Promise<ReadResult<TValue, DomainError>> {
  try {
    const data = await invokeCallable<TInput, TWire>(call);
    return success(call.project ? call.project(data) : (data as unknown as TValue));
  } catch (err) {
    return failure(classifyCallableError(err, call.overrides));
  }
}
