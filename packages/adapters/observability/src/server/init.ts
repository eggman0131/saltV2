import type { IncomingHttpHeaders } from 'node:http';
import { PostHog } from 'posthog-node';
import { trace, context, type Span as OtelSpan } from '@opentelemetry/api';

// EU region is baked in as the default; the host is overridable via env only so
// a self-hosted/dev proxy can be pointed at, never to silently leave the EU
// data region. Mirrors the browser side (src/init.ts) — Region = EU.
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

// Server-side telemetry is family-shared and not tied to a signed-in user the
// way the browser adapter is (the CF process serves every member). PostHog
// requires a distinctId on every capture; this stable id groups all server
// telemetry under one synthetic "person" so dashboards can filter it cleanly
// from real users without leaking any per-request identity.
const SERVER_DISTINCT_ID = 'salt-cloud-functions';

let client: PostHog | null = null;

// True once initServerObservability has built the posthog-node client. Adapter
// entrypoints gate on this so they stay inert — rather than throwing — when
// PostHog is uninitialised (e.g. POSTHOG_API_KEY not set in an emulator run).
// Adapters never throw for operational reasons (CLAUDE.md Rule 10).
export function isServerObservabilityInitialised(): boolean {
  return client !== null;
}

// Kept for call-site parity with the LD server adapter, which awaited an SDK
// readiness handshake before opening the first span on a cold start. posthog-node
// has no such handshake (capture is synchronous-enqueue + background flush), so
// this resolves immediately. Retained so existing `await whenServerObservabilityReady()`
// call sites keep compiling and reading sensibly.
export async function whenServerObservabilityReady(): Promise<void> {
  return Promise.resolve();
}

// Wires the posthog-node client. No-ops entirely when `key` is empty (mirrors
// the browser no-op-on-empty-key contract and how an absent LD_SDK_KEY gated LD
// off), so no client is built and every adapter method silently no-ops. Never
// throws: a misconfig or constructor failure leaves the package inert rather
// than crashing the function at module load.
export function initServerObservability(key: string): void {
  if (client) return;
  if (!key) return; // inert when the key is absent

  const host = process.env['POSTHOG_HOST'] || DEFAULT_POSTHOG_HOST;

  try {
    client = new PostHog(key, {
      host,
      // Cloud Functions are paused between invocations, so the default batch
      // window (events accumulate then flush on a timer) would strand events in
      // the queue. flushAt: 1 sends each event as it is captured; we still call
      // flushServerObservability() before returning to drain any in-flight send.
      flushAt: 1,
      flushInterval: 0,
    });
  } catch {
    // Stay inert rather than crash the function at startup.
    client = null;
  }
}

// Guards every posthog-node call so an internal SDK failure (capture, exception
// reporting, flush) can never throw across the port boundary. Telemetry is
// best-effort: a dropped event is always preferable to a thrown error in a
// caller's hot path (CLAUDE.md Rule 10).
export function safePosthog(fn: (ph: PostHog) => void): void {
  if (!client) return;
  try {
    fn(client);
  } catch {
    // Swallow — observability must never surface failures to callers.
  }
}

// Capture a plain server-side event under the synthetic server person. Used by
// the match-logging adapter; exposed so other CF telemetry can reuse the same
// inert/never-throw guard rather than touching the client directly.
export function captureServerEvent(event: string, properties: Record<string, unknown>): void {
  safePosthog((ph) => {
    ph.capture({ distinctId: SERVER_DISTINCT_ID, event, properties });
  });
}

// Report an exception to PostHog error tracking. Inert before init; never
// throws. The server counterpart to the browser ErrorReportingPort — there was
// no server error reporter before this phase (firebase-functions/logger stays
// additively at call sites).
export function captureServerException(error: unknown): void {
  safePosthog((ph) => {
    const err = error instanceof Error ? error : new Error(String(error));
    ph.captureException(err, SERVER_DISTINCT_ID);
  });
}

// ── $ai_generation ──────────────────────────────────────────────────────────
// Compact emitter for PostHog LLM observability. One `$ai_generation` event per
// Genkit AI call, carrying model / token usage / cost / latency so the AI cost
// surface is collected where it wasn't before. Property names follow PostHog's
// documented $ai_* schema (see products/llm_analytics). All token/cost fields
// are optional because Genkit's GenerationUsage fields are all optional and a
// fake/offline model run carries none of them.

// Genkit's GenerationUsage — only the fields we forward. Declared structurally
// (not imported from genkit) so this adapter takes no build-time dependency on
// the genkit package; the CF call sites pass `result.usage` straight in.
export interface AiGenerationUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiGenerationEvent {
  // The Genkit flow / call site name, e.g. 'parseEntry'. Becomes $ai_span_name.
  readonly flow: string;
  // The resolved model identifier passed to ai.generate, e.g. 'gemini-2.5-flash'.
  readonly model: string;
  // Provider is always Google's Gemini via @genkit-ai/google-genai.
  readonly provider?: string;
  // result.usage from the Genkit GenerateResponse (optional — absent for fakes).
  readonly usage?: AiGenerationUsage;
  // Wall-clock latency of the AI call in milliseconds (converted to seconds for
  // PostHog's $ai_latency, which is documented in seconds).
  readonly latencyMs?: number;
  // True when the call threw / timed out before producing usage.
  readonly isError?: boolean;
}

export function captureAiGeneration(ev: AiGenerationEvent): void {
  safePosthog((ph) => {
    const props: Record<string, unknown> = {
      $ai_model: ev.model,
      $ai_provider: ev.provider ?? 'gemini',
      $ai_span_name: ev.flow,
    };
    if (ev.usage?.inputTokens !== undefined) props.$ai_input_tokens = ev.usage.inputTokens;
    if (ev.usage?.outputTokens !== undefined) props.$ai_output_tokens = ev.usage.outputTokens;
    if (ev.latencyMs !== undefined) props.$ai_latency = ev.latencyMs / 1000;
    if (ev.isError !== undefined) props.$ai_is_error = ev.isError;
    ph.capture({ distinctId: SERVER_DISTINCT_ID, event: '$ai_generation', properties: props });
  });
}

// Flush pending telemetry. Cloud Functions should call this before returning so
// queued events aren't lost when the Node process is paused between invocations
// (posthog-node batches in the background). Repoints the LD server's
// flushServerObservability() contract onto posthog-node's flush(). Export
// failures (e.g. DNS unreachable in local dev) are non-fatal — the adapter must
// not surface operational telemetry errors to callers.
export async function flushServerObservability(): Promise<void> {
  if (!client) return;
  try {
    await client.flush();
  } catch {
    // Non-fatal: never surface a telemetry export failure to the caller.
  }
}

// ── Span/trace helpers against the ACTIVE provider ────────────────────────────
// enableFirebaseTelemetry() owns the single process-wide NodeTracerProvider;
// this package must NOT create its own (only one provider per process). These
// helpers therefore operate on whatever provider is globally registered via
// @opentelemetry/api — they read the active span and start spans on the global
// tracer, so they are correct whether Firebase telemetry is on (real spans) or
// off (no-op spans, in emulator/dev without GCP credentials).

const OTEL_SPAN = Symbol('otel-span');

export interface ObservabilitySpan {
  setAttribute(key: string, value: string | number | boolean): unknown;
  end(): void;
  readonly [OTEL_SPAN]: OtelSpan;
}

function wrap(span: OtelSpan): ObservabilitySpan {
  return {
    setAttribute(key, value) {
      span.setAttribute(key, value);
    },
    end() {
      span.end();
    },
    [OTEL_SPAN]: span,
  };
}

export interface StartSpanOptions {
  readonly parent?: ObservabilitySpan;
  // W3C traceparent / tracestate headers from the inbound request. Accepted for
  // call-site parity with the LD server adapter; unused while trace propagation
  // is DORMANT (see extractTraceHeaders below).
  readonly headers?: IncomingHttpHeaders;
}

// Rename the currently-active OTel span. Call this inside a Genkit flow body to
// append a human-readable descriptor (e.g. the item name) to the otherwise
// generic flow span name, so traces are scannable in the trace viewer. The flow
// span is the active span inside the flow body. No-op when no span is active
// (e.g. Firebase telemetry disabled in the emulator). Caps length so span names
// stay bounded even when fed long raw input.
const MAX_SPAN_NAME = 80;
export function setActiveSpanName(name: string): void {
  const trimmed = name.length > MAX_SPAN_NAME ? `${name.slice(0, MAX_SPAN_NAME - 1)}…` : name;
  trace.getActiveSpan()?.updateName(trimmed);
}

// Start a span on the globally-registered tracer (Firebase's, when telemetry is
// on). Inherits the active OTel context unless an explicit parent span is given,
// in which case the new span is nested under that parent (the cf-path match
// logger threads its flow span this way). When no provider is registered,
// @opentelemetry/api returns a non-recording span, so this degrades to a safe
// no-op without us owning a provider.
export function startSpan(name: string, opts?: StartSpanOptions): ObservabilitySpan {
  const tracer = trace.getTracer('salt-cloud-functions');
  const parentCtx = opts?.parent
    ? trace.setSpan(context.active(), opts.parent[OTEL_SPAN])
    : context.active();
  const span = tracer.startSpan(name, undefined, parentCtx);
  return wrap(span);
}

// W3C trace context extraction. Mirrors the browser-side helper's wire format.
//
// DORMANT: trace propagation — currently returns {} so the CF parents nothing,
// exactly the "tracing disabled" path. Cross-callable trace context propagation
// was disabled 2026-05-11 (it broke the Genkit Dev UI). Kept exported so
// re-enabling propagation is a one-line change at the call site. Grep
// "DORMANT: trace propagation" to find all plumbing sites.
export function extractTraceHeaders(_span: ObservabilitySpan): Record<string, string> {
  return {};
}
