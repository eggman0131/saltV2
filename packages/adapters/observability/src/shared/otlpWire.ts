// ── Runtime-neutral OTLP/JSON wire layer (shared by server + browser exporters) ─
// PostHog ingests spans as OTLP/JSON. THREE legs emit the EXACT SAME span shape,
// differing only by endpoint path and service.name:
//   • server AI leg          → /i/v0/ai/otel   (aiOtlpSpanProcessor.ts)
//   • server distributed leg → /i/v1/traces    (distributedSpanProcessor.ts)
//   • browser distributed leg→ /i/v1/traces    (browserTracerImpl.ts)
// This module is the SINGLE source of that shape so the wire schema cannot drift
// between fast-path (server) and the browser-rooted traces (issue #362, Phase 4).
// It lives in src/shared/ precisely so BOTH the default (browser) subpath and the
// /server subpath import it — that is the whole anti-drift point of src/shared/.
//
// RUNTIME-NEUTRAL (CLAUDE.md): NO process.env, NO Node built-ins, NO posthog-js,
// NO browser globals beyond pure data. The OTel types are declared STRUCTURALLY
// (no @opentelemetry/sdk-trace-* dependency), matching the rest of this package.
// The ONE import is `@opentelemetry/api`'s `SpanKind` enum — pure data, no runtime
// of its own, and already a dependency of BOTH subpaths — so the API→wire span-kind
// mapping below can name the API's kinds instead of re-declaring their numbers.
// Server-specific code (the POST helper, which reads process.env + Node fetch, and
// the server SERVICE_NAME) stays in src/server/otlpWire.ts, which re-exports
// everything here so existing server imports keep working unchanged.

import { SpanKind } from '@opentelemetry/api';

// EU region baked in as the default; host overridable via env only (never to
// silently leave the EU data region). Mirrors init.ts and the server leg.
export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

// PostHog's distributed-tracing OTLP/JSON ingestion path. ONE value for the two
// distributed legs (server `distributedSpanProcessor`, browser exporter) — the AI
// leg has its own (`/i/v0/ai/otel`), which is the only difference between them.
export const DISTRIBUTED_OTLP_PATH = '/i/v1/traces';

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

// ── Span kind: OTel JS API enum → OTLP wire enum (issue #1011) ────────────────
// These are TWO DIFFERENT enumerations of the same six concepts and they do NOT
// agree on the numbers. The OTLP protobuf reserves 0 for "unspecified", so its
// kinds start at 1; the JS API enum has no unspecified member and starts at 0:
//
//   `@opentelemetry/api` SpanKind │ OTLP `Span.SpanKind` (the wire)
//   ──────────────────────────────┼────────────────────────────────
//   (no member)                   │ 0  SPAN_KIND_UNSPECIFIED
//   INTERNAL = 0                  │ 1  SPAN_KIND_INTERNAL
//   SERVER   = 1                  │ 2  SPAN_KIND_SERVER
//   CLIENT   = 2                  │ 3  SPAN_KIND_CLIENT
//   PRODUCER = 3                  │ 4  SPAN_KIND_PRODUCER
//   CONSUMER = 4                  │ 5  SPAN_KIND_CONSUMER
//
// Both DISTRIBUTED legs used to forward `span.kind` RAW, which shipped every span
// one kind too low: INTERNAL arrived as UNSPECIFIED, SERVER as INTERNAL, CLIENT as
// SERVER. That does not look like corrupt data downstream — it looks like a
// plausible but WRONG service graph, because tracing backends key topology maps and
// parent/child rendering off span kind. Hence the fix is a behaviour change, taken
// deliberately (#1011).
//
// The AI leg is not an omission from that sentence: it AUTHORS its span rather
// than forwarding one, so it asserts SPAN_KIND_INTERNAL instead of mapping — the
// reasoning is at its `const out: OtlpSpan` (#1029).
//
// Stated as an explicit switch and NEVER as `apiKind + 1`: the offset is a
// coincidence of two independently-defined enums, not a rule, and arithmetic hides
// which concept maps to which. Best-effort, never throws (Rule 10) — an
// unrecognised kind maps to INTERNAL rather than failing an export. API `INTERNAL`
// (0) and "no kind at all" therefore BOTH land on wire 1, which is intended.
export const SPAN_KIND_INTERNAL = 1;
const SPAN_KIND_SERVER = 2;
const SPAN_KIND_CLIENT = 3;
const SPAN_KIND_PRODUCER = 4;
const SPAN_KIND_CONSUMER = 5;

/** Map a span's `@opentelemetry/api` kind onto the OTLP wire kind. */
export function toWireSpanKind(apiKind: number | undefined): number {
  switch (apiKind) {
    case SpanKind.INTERNAL:
      return SPAN_KIND_INTERNAL;
    case SpanKind.SERVER:
      return SPAN_KIND_SERVER;
    case SpanKind.CLIENT:
      return SPAN_KIND_CLIENT;
    case SpanKind.PRODUCER:
      return SPAN_KIND_PRODUCER;
    case SpanKind.CONSUMER:
      return SPAN_KIND_CONSUMER;
    default:
      return SPAN_KIND_INTERNAL;
  }
}

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

// ── Span → OTLP mapping MECHANISM (issue #1007) ───────────────────────────────
// Both distributed legs encoded attributes and built the span envelope with their
// own verbatim copy of this code. They live here now, so a change to how a float
// or an int64 is encoded cannot land on one leg and not the other — the whole
// reason src/shared/ exists. Only per-runtime POLICY stays out: which attributes
// a leg keeps (the server strips `genkit:*`) and what it appends (the server's
// AI content previews).

/**
 * Encode one span attribute value as OTLP/JSON. Only scalar types map cleanly:
 * strings and booleans ride typed, integers ride as `intValue` STRINGS (int64
 * exceeds JS number precision), other finite numbers ride as `stringValue`.
 * Non-finite numbers, objects, arrays, null and undefined are DROPPED (returns
 * null) — the trace views want structural metadata, not serialised blobs.
 */
export function encodeAttr(key: string, value: unknown): Attribute | null {
  if (typeof value === 'string') return strAttr(key, value);
  if (typeof value === 'boolean') return boolAttr(key, value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? intAttr(key, value) : strAttr(key, String(value));
  }
  return null;
}

/**
 * Encode a span's attribute bag, in insertion order, dropping whatever
 * `encodeAttr` cannot represent. `keep` is the per-leg policy hook: omit it to
 * encode everything (browser), or pass a predicate to filter by key first (the
 * server drops `genkit:*`).
 */
export function collectAttributes(
  attrs: Readonly<Record<string, unknown>>,
  keep?: (key: string) => boolean,
): Attribute[] {
  const attributes: Attribute[] = [];
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (keep && !keep(key)) continue;
    const encoded = encodeAttr(key, value);
    if (encoded) attributes.push(encoded);
  }
  return attributes;
}

/**
 * Build the OTLP span envelope from a finished span plus its ALREADY-ENCODED
 * attributes: ids from `spanContext()`, the span's live name (which
 * setActiveSpanName may have rewritten to a human-readable descriptor — that IS
 * the value for the trace view), the API→wire kind mapping, nanosecond times, and
 * `parentSpanId` OMITTED on a root span (never an empty string).
 */
export function toOtlpSpan(span: ReadableSpanLike, attributes: Attribute[]): OtlpSpan {
  const ctx = span.spanContext();
  const out: OtlpSpan = {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    name: span.name,
    kind: toWireSpanKind(span.kind),
    startTimeUnixNano: hrTimeToNanos(span.startTime),
    endTimeUnixNano: hrTimeToNanos(span.endTime),
    attributes,
  };
  const parent = parentSpanId(span);
  if (parent) out.parentSpanId = parent;
  return out;
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
