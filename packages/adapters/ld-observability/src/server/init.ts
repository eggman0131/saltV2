import type { IncomingHttpHeaders } from 'node:http';
import { init as initLDClient, type LDClient } from '@launchdarkly/node-server-sdk';
import { Observability, LDObserve } from '@launchdarkly/observability-node';
// `Span` is a type-only import — it doesn't survive into the runtime bundle,
// so it can't add a second copy of @opentelemetry/api. Keeping value imports
// of @opentelemetry/api would race with the copy bundled inside
// @launchdarkly/observability-node, and the resulting "duplicate registration"
// failure leaves LD's TracerProvider unregistered globally — spans created
// via LD's API end up no-op and never reach LD's exporter.
import type { Span as OtelSpan } from '@opentelemetry/api';

let client: LDClient | null = null;
let readyPromise: Promise<void> | null = null;
const INIT_TIMEOUT_MS = 5000;

// Auto-instrumentation defaults (HTTP, etc.) are controlled by env vars at
// deploy time, not constructor options:
//   OTEL_NODE_DISABLED_INSTRUMENTATIONS=http,dns,...
//   LAUNCHDARKLY_OTEL_NODE_ENABLE_OUTGOING_HTTP_INSTRUMENTATION=false
// See @launchdarkly/observability-node Options.d.ts.
//
// serviceName is set explicitly so CF spans are easy to find in LD (the
// browser SDK tags itself "browser"; without an override the Node SDK falls
// back to "unknown_service:node" which gets buried in dashboards).
export function initServerObservability(sdkKey: string): void {
  if (client) return;
  client = initLDClient(sdkKey, {
    plugins: [new Observability({ serviceName: 'salt-cloud-functions' })],
  });
  readyPromise = client
    .waitForInitialization({ timeout: INIT_TIMEOUT_MS / 1000 })
    .then(() => undefined)
    .catch(() => undefined);
}

export function isServerObservabilityInitialised(): boolean {
  return client !== null;
}

export async function whenServerObservabilityReady(): Promise<void> {
  if (readyPromise) await readyPromise;
}

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
  // W3C traceparent / tracestate headers from the inbound request. When
  // present, the new span is parented to the propagated client trace.
  readonly headers?: IncomingHttpHeaders;
}

function traceparentFromSpan(span: ObservabilitySpan): IncomingHttpHeaders {
  const otelSpan = span[OTEL_SPAN];
  const ctx = otelSpan.spanContext();
  if (!ctx.traceId || !ctx.spanId) return {};
  const flags = (ctx.traceFlags ?? 0).toString(16).padStart(2, '0');
  return { traceparent: `00-${ctx.traceId}-${ctx.spanId}-${flags}` };
}

// No-op span returned when LD observability isn't initialised. Carries a
// minimal OtelSpan-shaped object so call sites that read spanContext don't
// crash, but doesn't export anything.
const NOOP_OTEL_SPAN: OtelSpan = {
  spanContext: () => ({
    traceId: '00000000000000000000000000000000',
    spanId: '0000000000000000',
    traceFlags: 0,
  }),
  setAttribute: () => NOOP_OTEL_SPAN,
  setAttributes: () => NOOP_OTEL_SPAN,
  addEvent: () => NOOP_OTEL_SPAN,
  addLink: () => NOOP_OTEL_SPAN,
  addLinks: () => NOOP_OTEL_SPAN,
  setStatus: () => NOOP_OTEL_SPAN,
  updateName: () => NOOP_OTEL_SPAN,
  end: () => undefined,
  isRecording: () => false,
  recordException: () => undefined,
} as unknown as OtelSpan;

// Start a span via LDObserve. We always go through this path so spans live
// in LD's tracer regardless of which copy of @opentelemetry/api won the
// global registration race. For child spans, the parent's W3C trace context
// is reconstructed from its spanContext and passed as headers — LD's
// startWithHeaders parents the new span via the propagated traceparent.
//
// When LD isn't initialised (e.g. tests, or LD_SDK_KEY unset), returns a
// no-op wrapper so callers don't crash. The flow continues without
// observability; firebase-functions/logger continues to emit additively.
export function startSpan(name: string, opts?: StartSpanOptions): ObservabilitySpan {
  if (!client) return wrap(NOOP_OTEL_SPAN);
  const headers: IncomingHttpHeaders =
    opts?.headers ?? (opts?.parent ? traceparentFromSpan(opts.parent) : {});
  const { span } = LDObserve.startWithHeaders(name, headers);
  return wrap(span);
}

// Flush pending telemetry. Cloud Functions should call this before returning
// so spans aren't lost when the Node process is paused between invocations.
export async function flushServerObservability(): Promise<void> {
  if (!client) return;
  await LDObserve.flush();
}

// W3C trace context extraction. Mirrors the browser-side helper; same wire
// format so the CF can extract its trace headers when emitting downstream
// requests, or for tests asserting parity.
export function extractTraceHeaders(span: ObservabilitySpan): Record<string, string> {
  const otelSpan = span[OTEL_SPAN];
  const ctx = otelSpan.spanContext();
  if (!ctx.traceId || !ctx.spanId) return {};
  const flags = (ctx.traceFlags ?? 0).toString(16).padStart(2, '0');
  const headers: Record<string, string> = {
    traceparent: `00-${ctx.traceId}-${ctx.spanId}-${flags}`,
  };
  if (ctx.traceState) {
    const state = ctx.traceState.serialize();
    if (state) headers['tracestate'] = state;
  }
  return headers;
}
