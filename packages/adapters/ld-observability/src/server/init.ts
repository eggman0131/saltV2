import type { IncomingHttpHeaders } from 'node:http';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  AlwaysOnSampler,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { trace, propagation, context, diag, type Span as OtelSpan } from '@opentelemetry/api';
import { SPAN_TYPE_ATTR, TraceServerExporter, setTelemetryServerUrl } from 'genkit/tracing';

const LD_OTLP_ENDPOINT = 'https://otel.launchdarkly.com/v1/traces';

let provider: NodeTracerProvider | null = null;
let readyPromise: Promise<void> | null = null;

export function initServerObservability(sdkKey: string): void {
  if (provider) return;

  provider = new NodeTracerProvider({
    resource: new Resource({ 'service.name': 'salt-cloud-functions' }),
    // Honour the sampling decision carried in the upstream browser traceparent.
    // When there is no parent context (cold-start, direct invocation), always
    // sample so every first call is visible in LD.
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  });

  provider.addSpanProcessor(
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: LD_OTLP_ENDPOINT,
        headers: { Authorization: `ApiKey ${sdkKey}` },
      }),
    ),
  );

  const genkitUrl = process.env['GENKIT_TELEMETRY_SERVER'];
  if (genkitUrl) {
    setTelemetryServerUrl(genkitUrl);
    const genkitBatch = new BatchSpanProcessor(new TraceServerExporter());
    provider.addSpanProcessor({
      onStart(): void {},
      onEnd(span: ReadableSpan): void {
        if (span.attributes[SPAN_TYPE_ATTR] !== undefined) {
          genkitBatch.onEnd(span);
        }
      },
      forceFlush(): Promise<void> {
        return genkitBatch.forceFlush();
      },
      shutdown(): Promise<void> {
        return genkitBatch.shutdown();
      },
    });
  }

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
