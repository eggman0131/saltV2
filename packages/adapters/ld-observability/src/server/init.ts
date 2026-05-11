import type { IncomingHttpHeaders } from 'node:http';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  AlwaysOnSampler,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { trace, propagation, context, diag, type Span as OtelSpan } from '@opentelemetry/api';

const LD_OTLP_ENDPOINT = 'https://otel.observability.app.launchdarkly.com:4318/v1/traces';

let provider: NodeTracerProvider | null = null;
let readyPromise: Promise<void> | null = null;

export function initServerObservability(sdkKey: string): void {
  if (provider) return;

  provider = new NodeTracerProvider({
    resource: new Resource({
      'service.name': 'salt-cloud-functions',
      // LD observability authenticates by project ID in the resource attributes,
      // not via an Authorization header (mirrors @launchdarkly/observability-node).
      'highlight.project_id': sdkKey,
    }),
    // Honour the sampling decision carried in the upstream browser traceparent.
    // When there is no parent context (cold-start, direct invocation), always
    // sample so every first call is visible in LD.
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  });

  provider.addSpanProcessor(
    new BatchSpanProcessor(new OTLPTraceExporter({ url: LD_OTLP_ENDPOINT })),
  );

  provider.register();

  // Auto-instrumentations registered against this provider.
  // Active: http (inbound callable HTTP + outbound requests), grpc (Firestore RPCs).
  // To disable an instrumentation, pass { enabled: false } in its constructor config,
  // e.g. new HttpInstrumentation({ enabled: false }).
  // To add more instrumentations, extend the array here — not in the CF entrypoint.
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [new HttpInstrumentation(), new GrpcInstrumentation()],
  });

  readyPromise = Promise.resolve();
}

export function isServerObservabilityInitialised(): boolean {
  return provider !== null;
}

export async function whenServerObservabilityReady(): Promise<void> {
  if (readyPromise) await readyPromise;
}

// Register an additional SpanProcessor with the provider built by
// initServerObservability. No-op when the provider hasn't been initialised
// yet (e.g. LD_SDK_KEY not set). Must be called after initServerObservability.
// Use this hook for CF-local concerns — such as Genkit dev-trace routing —
// that must not live inside the ld-observability adapter.
export function addServerSpanProcessor(processor: SpanProcessor): void {
  if (!provider) return;
  provider.addSpanProcessor(processor);
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

// No-op span returned when observability isn't initialised. Carries a
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

export function startSpan(name: string, opts?: StartSpanOptions): ObservabilitySpan {
  if (!provider) return wrap(NOOP_OTEL_SPAN);

  let parentCtx = context.active();
  if (opts?.parent) {
    parentCtx = trace.setSpan(parentCtx, opts.parent[OTEL_SPAN]);
  } else if (opts?.headers) {
    parentCtx = propagation.extract(parentCtx, opts.headers);
  }

  const span = trace.getTracer('salt-cloud-functions').startSpan(name, {}, parentCtx);
  return wrap(span);
}

// Flush pending telemetry. Cloud Functions should call this before returning
// so spans aren't lost when the Node process is paused between invocations.
// Export failures (e.g. DNS unreachable in local dev) are non-fatal — the
// adapter must not surface operational telemetry errors to callers.
export async function flushServerObservability(): Promise<void> {
  if (!provider) return;
  await provider.forceFlush().catch((err: unknown) => {
    diag.warn('flushServerObservability: export failed (non-fatal)', err);
  });
}

// Run `fn` inside an OTel context populated from `headers` (W3C traceparent
// / tracestate). Use this at a callable entrypoint to make the propagated
// browser trace the active context BEFORE any flow span opens — otherwise
// Genkit/Firestore spans root a fresh trace and never join the browser's.
// No-op when observability isn't initialised.
//
// DORMANT: trace propagation — currently has no callers. matchOrCreateCanon
// previously used this to unify browser↔CF traces, but parenting the flow
// span under the browser span made it a non-root, which the Genkit Dev UI's
// trace list filters out. Kept exported so re-enabling propagation is a
// one-line change at the call site. See apps/cloud-functions/src/index.ts.
export async function runWithExtractedTraceContext<T>(
  headers: IncomingHttpHeaders | Record<string, string | undefined> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!provider) return fn();
  const ctx = propagation.extract(context.active(), headers ?? {});
  return context.with(ctx, fn);
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
