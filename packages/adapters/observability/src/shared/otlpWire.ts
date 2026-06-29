// ── Runtime-neutral OTLP/JSON wire layer (shared by server + browser exporters) ─
// PostHog ingests spans as OTLP/JSON. THREE legs emit the EXACT SAME span shape,
// differing only by endpoint path and service.name:
//   • server AI leg          → /i/v0/ai/otel   (aiOtlpSpanProcessor.ts)
//   • server distributed leg → /i/v1/traces    (distributedSpanProcessor.ts)
//   • browser distributed leg→ /i/v1/traces    (browserTracer.ts)
// This module is the SINGLE source of that shape so the wire schema cannot drift
// between fast-path (server) and the browser-rooted traces (issue #362, Phase 4).
// It lives in src/shared/ precisely so BOTH the default (browser) subpath and the
// /server subpath import it — that is the whole anti-drift point of src/shared/.
//
// RUNTIME-NEUTRAL (CLAUDE.md): NO process.env, NO Node built-ins, NO posthog-js,
// NO browser globals beyond pure data. The OTel types are declared STRUCTURALLY
// (no @opentelemetry/sdk-trace-* dependency), matching the rest of this package.
// Server-specific code (the POST helper, which reads process.env + Node fetch, and
// the server SERVICE_NAME) stays in src/server/otlpWire.ts, which re-exports
// everything here so existing server imports keep working unchanged.

// EU region baked in as the default; host overridable via env only (never to
// silently leave the EU data region). Mirrors init.ts and the server leg.
export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

// ── Structural OTel types (no `@opentelemetry/sdk-trace-*` dependency) ─────────

/** OTel HrTime: [epoch seconds, nanos-within-second]. */
export type HrTime = readonly [number, number];

/** The subset of OTel `ReadableSpan` we read. */
export interface ReadableSpanLike {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly startTime: HrTime;
  readonly endTime: HrTime;
  // OTel 1.x exposes `parentSpanId`; 2.x exposes `parentSpanContext`. Read both.
  readonly parentSpanId?: string;
  readonly parentSpanContext?: { readonly spanId?: string };
  readonly kind?: number;
  // The originating tracer/instrumentation scope. OTel 1.x exposes
  // `instrumentationLibrary`; newer SDKs expose `instrumentationScope`. Read both.
  // The distributed leg uses this to keep our own/Genkit spans and drop the noisy
  // auto-instrumentation (fs/HTTP/@google-cloud/firestore) that must NOT surface
  // as top-level trace nodes (issue #362 follow-up).
  readonly instrumentationScope?: { readonly name?: string };
  readonly instrumentationLibrary?: { readonly name?: string };
  spanContext(): { readonly traceId: string; readonly spanId: string };
}

/** The `SpanProcessor` shape `BasicTracerProvider.addSpanProcessor` accepts. */
export interface SpanProcessorLike {
  onStart(): void;
  onEnd(span: ReadableSpanLike): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

// ── OTLP/JSON wire helpers (mirror the PoC's proven shape) ─────────────────────

export type AttrValue = { stringValue: string } | { intValue: string } | { boolValue: boolean };
export interface Attribute {
  key: string;
  value: AttrValue;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attribute[];
}

export const strAttr = (key: string, v: string): Attribute => ({
  key,
  value: { stringValue: v },
});
// int64 must be a string in OTLP/JSON to avoid JS number precision loss.
export const intAttr = (key: string, v: number): Attribute => ({
  key,
  value: { intValue: String(v) },
});
export const boolAttr = (key: string, v: boolean): Attribute => ({
  key,
  value: { boolValue: v },
});

export const SPAN_KIND_INTERNAL = 1;

/** HrTime → OTLP nanosecond string (BigInt: epoch-ns exceeds Number precision). */
export function hrTimeToNanos(t: HrTime): string {
  if (!Array.isArray(t) || t.length < 2) return '0';
  const seconds = Number(t[0]) || 0;
  const nanos = Number(t[1]) || 0;
  return (BigInt(Math.trunc(seconds)) * 1_000_000_000n + BigInt(Math.trunc(nanos))).toString();
}

/** `span.parentSpanId` (OTel 1.x) or `span.parentSpanContext.spanId` (2.x). */
export function parentSpanId(span: ReadableSpanLike): string | undefined {
  return span.parentSpanId ?? span.parentSpanContext?.spanId ?? undefined;
}

// Wrap one OR MORE OTLP spans in the resourceSpans → scopeSpans → spans envelope
// PostHog's OTLP ingestion expects. `serviceName` distinguishes the emitter
// (`salt-cloud-functions` server-side, `salt-web-pwa` browser-side) so traces are
// attributable to a runtime; the wire SHAPE is identical across both. Accepts a
// single span (server per-span export) or an array (browser batch export).
//
// `environment` ('production' | 'staging' | 'development') rides as a RESOURCE
// attribute under the OTel-standard semantic-convention key `deployment.environment`
// — the same dimension events/logs carry — so it applies to EVERY span in the batch
// with one stamp. PostHog forwards any non-excluded resource/span attribute onto the
// resulting event as-is, so it surfaces as the `deployment.environment` property on
// BOTH OTLP endpoints (distributed `/i/v1/traces` and AI `/i/v0/ai/otel`). Computed
// identically to the event/log dimension: the server resolves it from the Firebase
// project id (resolveServerEnvironment), the browser from import.meta.env.MODE —
// each runtime passes its value down to here. Omitted when absent (pre-init /
// unconfigured) so nothing rides along, exactly like the event-side super-property
// merge. `deployment.environment` is the single environment key across ALL telemetry
// (spans + events + exceptions) so the app is OTel-standard and consistent.
export function buildOtlpBody(
  span: OtlpSpan | OtlpSpan[],
  serviceName: string,
  environment?: string,
): unknown {
  const spans = Array.isArray(span) ? span : [span];
  const attributes = [strAttr('service.name', serviceName)];
  if (environment) attributes.push(strAttr('deployment.environment', environment));
  return {
    resourceSpans: [
      {
        resource: { attributes },
        scopeSpans: [{ scope: { name: serviceName }, spans }],
      },
    ],
  };
}
